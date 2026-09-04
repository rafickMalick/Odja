import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

/**
 * Limitation de débit.
 *
 * Elle ne protège pas l'API contre une attaque distribuée — c'est le rôle
 * d'une couche en amont. Elle protège contre ce qui arrive vraiment sans elle :
 * **le forçage d'un mot de passe** et **le forçage d'un code OTP à quatre
 * chiffres**. Dix mille essais sur un code à quatre chiffres le trouvent en
 * quelques minutes ; à cinq tentatives par quart d'heure, il faut des années.
 *
 * Le compteur vit en mémoire, volontairement. Un stockage partagé serait
 * nécessaire à plusieurs instances, mais l'introduire ici reviendrait à faire
 * dépendre l'authentification de la disponibilité de Redis : une panne de
 * cache fermerait la porte à tout le monde. À une instance, la mémoire suffit ;
 * à plusieurs, la limite s'applique par instance, ce qui reste très au-dessous
 * du seuil de nuisance.
 */

export interface RateLimit {
  /** Nombre d'appels autorisés dans la fenêtre. */
  limit: number;
  /** Durée de la fenêtre, en secondes. */
  windowSeconds: number;
}

export const RATE_LIMIT_KEY = 'oja:rate-limit';

/** Pose une limite sur une route ou un contrôleur. */
export const Throttle = (limit: number, windowSeconds: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSeconds } satisfies RateLimit);

interface Counter {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly counters = new Map<string, Counter>();
  private lastSweep = Date.now();
  private readonly enabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    config?: ConfigService,
  ) {
    /* Actif partout sauf en test, où la suite martèle volontairement la
       connexion depuis une seule adresse. Le comportement du garde reste
       couvert par ses propres tests unitaires, qui l'instancient directement :
       le débrayer ici ne laisse aucun angle mort. */
    this.enabled = config?.get<boolean>('RATE_LIMIT_ENABLED') ?? true;
    if (!this.enabled) {
      this.logger.warn('Limitation de débit désactivée (RATE_LIMIT_ENABLED=false)');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.enabled) return true;

    const rule = this.reflector.getAllAndOverride<RateLimit | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sans annotation, aucune limite : on ne bride pas la navigation du
    // catalogue pour protéger la page de connexion.
    if (!rule) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const key = `${request.method}:${request.route?.path ?? request.path}:${clientOf(request)}`;
    const now = Date.now();

    this.sweep(now);

    const counter = this.counters.get(key);
    if (!counter || counter.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
      return true;
    }

    counter.count += 1;

    if (counter.count > rule.limit) {
      const retryAfter = Math.ceil((counter.resetAt - now) / 1000);
      response.setHeader('Retry-After', String(retryAfter));

      this.logger.warn(`Débit dépassé sur ${key} (${counter.count} appels)`);

      throw new HttpException(
        {
          error: 'Trop de tentatives',
          message: `Trop de tentatives. Réessayez dans ${humanDelay(retryAfter)}.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Purge des compteurs expirés.
   *
   * Sans elle, la table grossit d'une entrée par adresse IP vue et ne
   * redescend jamais : une fuite de mémoire lente, invisible en
   * développement, fatale au bout de quelques semaines en production.
   */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;

    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now) this.counters.delete(key);
    }
  }
}

/**
 * Qui compte comme « le même appelant ».
 *
 * L'utilisateur connecté d'abord : deux personnes derrière le même NAT
 * d'entreprise ne doivent pas se bloquer l'une l'autre. À défaut, l'adresse.
 */
function clientOf(request: Request): string {
  const user = (request as Request & { user?: { id?: string } }).user;
  if (user?.id) return `u:${user.id}`;
  return `ip:${request.ip ?? 'inconnu'}`;
}

function humanDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} secondes`;
  return `${Math.ceil(seconds / 60)} minutes`;
}
