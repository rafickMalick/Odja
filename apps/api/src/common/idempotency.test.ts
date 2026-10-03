import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { Prisma } from '@oja/db';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service';
import { IdempotencyInterceptor, readIdempotencyKey, requestFingerprint } from './idempotency';

/**
 * Idempotence des requêtes d'argent, sans base : la base réelle est couverte
 * par le parcours d'achat de bout en bout. Ici, chaque branche de décision.
 */

type Row = {
  id: string;
  userId: string;
  key: string;
  requestHash: string;
  status: string;
  responseBody: unknown;
  expiresAt: Date;
};

function fakePrisma(initial: Row[] = []) {
  const rows = [...initial];
  const store = {
    findUnique: vi.fn(
      async ({ where }: { where: { userId_key: { userId: string; key: string } } }) =>
        rows.find((r) => r.userId === where.userId_key.userId && r.key === where.userId_key.key) ??
        null,
    ),
    create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'status' | 'responseBody'> }) => {
      if (rows.some((r) => r.userId === data.userId && r.key === data.key)) {
        throw new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        });
      }
      const row = {
        ...data,
        id: `id-${rows.length + 1}`,
        status: 'IN_PROGRESS',
        responseBody: null,
      };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = rows.findIndex((r) => r.id === where.id);
      if (index >= 0) rows.splice(index, 1);
      return { count: index >= 0 ? 1 : 0 };
    }),
  };
  return { prisma: { idempotencyKey: store } as unknown as PrismaService, rows };
}

function contextFor(body: unknown, key?: string, userId = 'user-1') {
  const setHeader = vi.fn();
  const request = {
    method: 'POST',
    path: '/api/v1/checkout',
    body,
    headers: key ? { 'idempotency-key': key } : {},
    user: { id: userId },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  return { context, setHeader };
}

const handlerReturning = (value: unknown) => {
  const handle = vi.fn(() => of(value));
  return { handler: { handle } as CallHandler, handle };
};

const KEY = 'commande-0123456789';
const BODY = { addressId: 'a1', expectedTotalXof: 12_000 };

describe('Empreinte de requête', () => {
  it('ne dépend pas de l’ordre des clés du corps', () => {
    expect(requestFingerprint('POST', '/x', { a: 1, b: { c: 2, d: 3 } })).toBe(
      requestFingerprint('post', '/x', { b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it('change avec le corps, le chemin ou la méthode', () => {
    const base = requestFingerprint('POST', '/x', { a: 1 });
    expect(requestFingerprint('POST', '/x', { a: 2 })).not.toBe(base);
    expect(requestFingerprint('POST', '/y', { a: 1 })).not.toBe(base);
    expect(requestFingerprint('PUT', '/x', { a: 1 })).not.toBe(base);
  });
});

describe('En-tête Idempotency-Key', () => {
  const read = (value?: string) =>
    readIdempotencyKey({
      headers: value === undefined ? {} : { 'idempotency-key': value },
    } as never);

  it('est facultatif', () => {
    expect(read()).toBeNull();
    expect(read('')).toBeNull();
  });

  it('accepte un UUID', () => {
    expect(read('3f2b8c1e-9d4a-4f6b-8e2a-1c5d7e9f0a3b')).toBe(
      '3f2b8c1e-9d4a-4f6b-8e2a-1c5d7e9f0a3b',
    );
  });

  it('refuse une clé trop courte ou exotique', () => {
    expect(() => read('court')).toThrow(BadRequestException);
    expect(() => read('avec des espaces partout')).toThrow(BadRequestException);
  });
});

describe('Intercepteur', () => {
  it('sans clé, laisse passer sans rien mémoriser', async () => {
    const { prisma, rows } = fakePrisma();
    const { handler, handle } = handlerReturning({ reference: 'CMD-1' });
    const { context } = contextFor(BODY);

    await lastValueFrom(new IdempotencyInterceptor(prisma).intercept(context, handler));

    expect(handle).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(0);
  });

  it('rejoue la première réponse au lieu de recommencer', async () => {
    const { prisma } = fakePrisma();
    const interceptor = new IdempotencyInterceptor(prisma);

    const first = handlerReturning({ reference: 'CMD-1' });
    const firstCall = contextFor(BODY, KEY);
    const firstBody = await lastValueFrom(interceptor.intercept(firstCall.context, first.handler));

    const second = handlerReturning({ reference: 'CMD-2' });
    const secondCall = contextFor({ expectedTotalXof: 12_000, addressId: 'a1' }, KEY);
    const secondBody = await lastValueFrom(
      interceptor.intercept(secondCall.context, second.handler),
    );

    expect(firstBody).toEqual({ reference: 'CMD-1' });
    expect(secondBody).toEqual({ reference: 'CMD-1' });
    expect(second.handle).not.toHaveBeenCalled();
    expect(secondCall.setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
    expect(firstCall.setHeader).not.toHaveBeenCalled();
  });

  it('répond 409 tant que la première requête tourne', async () => {
    const { prisma } = fakePrisma([
      {
        id: 'r1',
        userId: 'user-1',
        key: KEY,
        requestHash: requestFingerprint('POST', '/api/v1/checkout', BODY),
        status: 'IN_PROGRESS',
        responseBody: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const { handler, handle } = handlerReturning({});

    await expect(
      lastValueFrom(
        new IdempotencyInterceptor(prisma).intercept(contextFor(BODY, KEY).context, handler),
      ),
    ).rejects.toThrow(ConflictException);
    expect(handle).not.toHaveBeenCalled();
  });

  it('refuse la même clé pour une autre requête (422)', async () => {
    const { prisma } = fakePrisma();
    const interceptor = new IdempotencyInterceptor(prisma);
    await lastValueFrom(
      interceptor.intercept(contextFor(BODY, KEY).context, handlerReturning({}).handler),
    );

    const other = handlerReturning({});
    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor({ ...BODY, expectedTotalXof: 99 }, KEY).context,
          other.handler,
        ),
      ),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(other.handle).not.toHaveBeenCalled();
  });

  it('libère la clé quand la requête échoue : on peut réessayer', async () => {
    const { prisma, rows } = fakePrisma();
    const interceptor = new IdempotencyInterceptor(prisma);
    const failing = { handle: () => throwError(() => new ConflictException('Total changé')) };

    await expect(
      lastValueFrom(interceptor.intercept(contextFor(BODY, KEY).context, failing)),
    ).rejects.toThrow('Total changé');
    expect(rows).toHaveLength(0);

    const retry = handlerReturning({ reference: 'CMD-1' });
    await expect(
      lastValueFrom(interceptor.intercept(contextFor(BODY, KEY).context, retry.handler)),
    ).resolves.toEqual({ reference: 'CMD-1' });
  });

  it('une clé expirée ne protège plus rien', async () => {
    const { prisma } = fakePrisma([
      {
        id: 'r1',
        userId: 'user-1',
        key: KEY,
        requestHash: requestFingerprint('POST', '/api/v1/checkout', BODY),
        status: 'COMPLETED',
        responseBody: { reference: 'CMD-ANCIENNE' },
        expiresAt: new Date(Date.now() - 1),
      },
    ]);
    const fresh = handlerReturning({ reference: 'CMD-NEUVE' });

    await expect(
      lastValueFrom(
        new IdempotencyInterceptor(prisma).intercept(contextFor(BODY, KEY).context, fresh.handler),
      ),
    ).resolves.toEqual({ reference: 'CMD-NEUVE' });
  });

  it('les clés sont propres à chaque utilisateur', async () => {
    const { prisma } = fakePrisma();
    const interceptor = new IdempotencyInterceptor(prisma);
    await lastValueFrom(
      interceptor.intercept(
        contextFor(BODY, KEY, 'user-1').context,
        handlerReturning({ by: 1 }).handler,
      ),
    );

    const other = handlerReturning({ by: 2 });
    await expect(
      lastValueFrom(interceptor.intercept(contextFor(BODY, KEY, 'user-2').context, other.handler)),
    ).resolves.toEqual({ by: 2 });
    expect(other.handle).toHaveBeenCalledOnce();
  });
});
