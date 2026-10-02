import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service';
import { AdminBootstrapService } from './admin-bootstrap.service';

/**
 * Premier administrateur (ADMIN_BOOTSTRAP_EMAIL).
 *
 * Ce qui compte : la variable ne promeut que l'adresse désignée, et seulement
 * tant qu'aucun admin n'existe. Oubliée sur Render, elle ne doit jamais
 * permettre d'en fabriquer un second.
 */

function serviceWith(options: { email?: string; admins?: number }) {
  const prisma = {
    user: {
      count: vi.fn(async () => options.admins ?? 0),
      findFirst: vi.fn(async () => ({ id: 'u1', email: 'awa@oja.market' })),
      findUniqueOrThrow: vi.fn(async () => ({ role: 'CUSTOMER', status: 'ACTIVE' })),
      update: vi.fn((args: unknown) => args),
    },
    auditLog: { create: vi.fn((args: unknown) => args) },
    $transaction: vi.fn(async (operations: unknown[]) => operations),
  };
  const config = {
    get: (key: string) => (key === 'ADMIN_BOOTSTRAP_EMAIL' ? options.email : undefined),
  } as unknown as ConfigService;

  return {
    service: new AdminBootstrapService(prisma as unknown as PrismaService, config),
    prisma,
  };
}

describe('Premier administrateur', () => {
  it('promeut l’adresse désignée quand aucun admin n’existe', async () => {
    const { service, prisma } = serviceWith({ email: ' Awa@Oja.market ' });

    await expect(service.promoteIfDesignated('u1', 'awa@oja.market')).resolves.toBe(true);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'ADMIN', status: 'ACTIVE' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'user.admin.bootstrap', targetId: 'u1' }),
      }),
    );
  });

  it('ne fait rien dès qu’un admin existe', async () => {
    const { service, prisma } = serviceWith({ email: 'awa@oja.market', admins: 1 });

    await expect(service.promoteIfDesignated('u1', 'awa@oja.market')).resolves.toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('ignore toute autre adresse', async () => {
    const { service, prisma } = serviceWith({ email: 'awa@oja.market' });

    await expect(service.promoteIfDesignated('u2', 'quelquun@exemple.com')).resolves.toBe(false);
    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('ne fait rien sans variable', async () => {
    const { service, prisma } = serviceWith({});

    await service.onApplicationBootstrap();
    await expect(service.promoteIfDesignated('u1', 'awa@oja.market')).resolves.toBe(false);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('promeut au démarrage un compte déjà inscrit', async () => {
    const { service, prisma } = serviceWith({ email: 'awa@oja.market' });

    await service.onApplicationBootstrap();
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});
