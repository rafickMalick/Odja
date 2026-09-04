import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { RATE_LIMIT_KEY, RateLimitGuard, type RateLimit } from './rate-limit.guard';

/**
 * La limitation de débit, vérifiée sur ce qu'elle promet.
 *
 * Ce n'est pas un détail d'ergonomie : sans elle, le code de remise à quatre
 * chiffres tombe en quelques minutes de force brute, et une livraison est
 * validée sans que le client ait rien reçu.
 */

function contextFor(options: {
  rule?: RateLimit;
  ip?: string;
  userId?: string;
}): { context: ExecutionContext; headers: Record<string, string> } {
  const headers: Record<string, string> = {};

  const request = {
    method: 'POST',
    path: '/api/v1/auth/login',
    route: { path: '/api/v1/auth/login' },
    ip: options.ip ?? '10.0.0.1',
    ...(options.userId ? { user: { id: options.userId } } : {}),
  };

  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;

  return { context, headers };
}

function guardWith(rule: RateLimit | undefined): RateLimitGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
    key === RATE_LIMIT_KEY ? rule : undefined,
  );
  return new RateLimitGuard(reflector);
}

describe('Limitation de débit', () => {
  it('laisse passer les routes sans annotation', () => {
    const guard = guardWith(undefined);
    const { context } = contextFor({});

    // Le catalogue ne doit pas être bridé pour protéger la connexion.
    for (let i = 0; i < 200; i++) {
      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it('autorise jusqu’à la limite, puis refuse', () => {
    const guard = guardWith({ limit: 3, windowSeconds: 900 });
    const { context, headers } = contextFor({});

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);

    expect(() => guard.canActivate(context)).toThrow(HttpException);

    // Le client doit savoir quand réessayer, pas seulement qu'il est refusé.
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('renvoie 429, pas 400', () => {
    const guard = guardWith({ limit: 1, windowSeconds: 900 });
    const { context } = contextFor({});
    guard.canActivate(context);

    try {
      guard.canActivate(context);
      expect.unreachable('la deuxième tentative devait être refusée');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });

  it('compte séparément deux adresses différentes', () => {
    const guard = guardWith({ limit: 2, windowSeconds: 900 });
    const first = contextFor({ ip: '10.0.0.1' });
    const second = contextFor({ ip: '10.0.0.2' });

    guard.canActivate(first.context);
    guard.canActivate(first.context);
    expect(() => guard.canActivate(first.context)).toThrow();

    // Le voisin n'a rien fait : il ne doit pas être puni.
    expect(guard.canActivate(second.context)).toBe(true);
  });

  it('compte par utilisateur quand il est connu, pas par adresse', () => {
    const guard = guardWith({ limit: 2, windowSeconds: 900 });

    /* Deux personnes derrière le même NAT d'entreprise sortent avec la même
       adresse publique. Sans distinction par utilisateur, la première à se
       tromper de mot de passe bloquerait toute la société. */
    const alice = contextFor({ ip: '203.0.113.7', userId: 'alice' });
    const bob = contextFor({ ip: '203.0.113.7', userId: 'bob' });

    guard.canActivate(alice.context);
    guard.canActivate(alice.context);
    expect(() => guard.canActivate(alice.context)).toThrow();

    expect(guard.canActivate(bob.context)).toBe(true);
  });

  it('rouvre la porte une fois la fenêtre écoulée', () => {
    const guard = guardWith({ limit: 1, windowSeconds: 1 });
    const { context } = contextFor({});

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow();

    // Fenêtre d'une seconde : on avance l'horloge plutôt que d'attendre.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 2_000);

    expect(guard.canActivate(context)).toBe(true);
    vi.restoreAllMocks();
  });
});
