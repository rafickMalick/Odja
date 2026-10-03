import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import { AuditInterceptor, NO_AUDIT_KEY } from './audit.interceptor';
import { REDACTED } from './redact';

/**
 * Audit automatique, sans base : quelles requêtes sont tracées, et ce qui
 * en est écrit. Le parcours réel est couvert par admin-team.e2e.test.ts.
 */

function setup(metadata: Record<string, unknown>, request: Record<string, unknown>) {
  const create = vi.fn(async () => ({}));
  const prisma = { auditLog: { create } } as unknown as PrismaService;
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => metadata[key as string]);

  const context = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const handler: CallHandler = { handle: () => of({ ok: true }) };

  return {
    run: () => lastValueFrom(new AuditInterceptor(reflector, prisma).intercept(context, handler)),
    create,
  };
}

const adminRequest = (over: Record<string, unknown> = {}) => ({
  method: 'POST',
  path: '/api/v1/admin/makers/mk_123/approve',
  route: { path: '/api/v1/admin/makers/:id/approve' },
  params: { id: 'mk_123' },
  body: { note: 'Dossier complet', password: 'ne-doit-pas-sortir' },
  ip: '203.0.113.7',
  user: { id: 'admin-1', role: 'ADMIN', sessionId: 's1' },
  ...over,
});

describe('Audit automatique', () => {
  it('trace une action d’administration réussie, secrets masqués', async () => {
    const { run, create } = setup({ [ROLES_KEY]: ['ADMIN'] }, adminRequest());

    await expect(run()).resolves.toEqual({ ok: true });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        actorRole: 'ADMIN',
        action: 'http.POST /admin/makers/:id/approve',
        targetType: 'makers',
        targetId: 'mk_123',
        after: {
          params: { id: 'mk_123' },
          body: { note: 'Dossier complet', password: REDACTED },
        },
        ip: '203.0.113.7',
      },
    });
  });

  it('ignore les lectures', async () => {
    const { run, create } = setup({ [ROLES_KEY]: ['ADMIN'] }, adminRequest({ method: 'GET' }));
    await run();
    expect(create).not.toHaveBeenCalled();
  });

  it('ignore les routes qui ne sont pas réservées aux admins', async () => {
    const { run, create } = setup({ [ROLES_KEY]: ['CUSTOMER'] }, adminRequest());
    await run();
    expect(create).not.toHaveBeenCalled();
  });

  it('respecte @NoAudit()', async () => {
    const { run, create } = setup({ [ROLES_KEY]: ['ADMIN'], [NO_AUDIT_KEY]: true }, adminRequest());
    await run();
    expect(create).not.toHaveBeenCalled();
  });

  it('un journal en panne ne fait pas échouer l’action déjà faite', async () => {
    const { run, create } = setup({ [ROLES_KEY]: ['ADMIN'] }, adminRequest());
    create.mockRejectedValueOnce(new Error('base indisponible'));
    await expect(run()).resolves.toEqual({ ok: true });
  });
});
