import { createHash } from 'node:crypto';

import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Prisma } from '@oja/db';
import type { Request, Response } from 'express';
import { Observable, catchError, from, map, of, switchMap, throwError } from 'rxjs';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Idempotence des requêtes qui engagent de l'argent (cahier L0-25).
 *
 * Le client joint un en-tête `Idempotency-Key` choisi par lui, le même tant
 * qu'il rejoue **la même intention**. Sans lui, un double clic ou un réseau
 * qui renvoie la requête crée deux commandes ; et un client dont la réponse
 * s'est perdue réessaie pour lire « panier vide », alors que sa commande
 * existe.
 *
 * Pour une clé déjà vue :
 *
 *   · requête terminée → la **même réponse** est rejouée, rien n'est recréé,
 *     et l'en-tête `Idempotent-Replayed: true` le signale ;
 *   · requête encore en cours → `409`, le client réessaiera ;
 *   · même clé, autre requête → `422` : une clé ne sert qu'à une intention.
 *
 * Une requête en échec efface sa clé : le client peut corriger et réessayer
 * avec la même. Seules les réussites sont mémorisées, 24 h.
 *
 * L'en-tête reste **facultatif** : le front et l'API se déploient
 * séparément, et l'exiger d'un coup bloquerait les commandes depuis un front
 * pas encore à jour. Sans clé, la route se comporte comme avant.
 */

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAYED_HEADER = 'Idempotent-Replayed';
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** UUID, ULID ou toute chaîne opaque raisonnable. */
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

/** Empreinte stable de la requête : l'ordre des clés du corps ne compte pas. */
export function requestFingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${path}\n${stableStringify(body ?? null)}`)
    .digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Lit et valide l'en-tête. `null` : pas de clé, la route se comporte comme avant. */
export function readIdempotencyKey(request: Request): string | null {
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') return null;
  if (!KEY_PATTERN.test(value)) {
    throw new BadRequestException(
      'En-tête Idempotency-Key invalide : 8 à 128 caractères, lettres, chiffres, « _ . : - ».',
    );
  }
  return value;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthenticatedUser }>();
    const response = http.getResponse<Response>();

    const key = readIdempotencyKey(request);
    const userId = request.user?.id;
    // Sans clé, ou sur une route publique : rien à protéger par utilisateur.
    if (!key || !userId) return next.handle();

    const requestHash = requestFingerprint(request.method, request.path, request.body);

    return from(this.claim(userId, key, requestHash)).pipe(
      switchMap((claim) => {
        if (claim.replay) {
          response.setHeader(REPLAYED_HEADER, 'true');
          return of(claim.body);
        }

        /* La réponse est mémorisée **avant** de partir : sinon un client qui
           réessaie aussitôt trouverait encore la clé « en cours ». */
        return next.handle().pipe(
          // Échec du traitement : la clé est libérée, le client peut réessayer.
          catchError((error: unknown) =>
            from(this.release(claim.id)).pipe(switchMap(() => throwError(() => error))),
          ),
          // Réussite : la mémoriser ne doit jamais transformer en erreur une
          // commande déjà créée. Un échec ici est seulement journalisé.
          switchMap((body) => from(this.complete(claim.id, body)).pipe(map(() => body))),
        );
      }),
    );
  }

  /**
   * Réserve la clé, ou retrouve la réponse déjà donnée.
   *
   * La réservation passe par l'unicité `(userId, key)` en base : deux
   * requêtes simultanées ne peuvent pas la prendre toutes les deux, quel que
   * soit le nombre d'instances de l'API.
   */
  private async claim(
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<{ replay: true; body: unknown } | { replay: false; id: string }> {
    const now = new Date();

    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { userId_key: { userId, key } },
      });

      if (existing && existing.expiresAt <= now) {
        // Expirée : elle ne protège plus rien, la place est libre.
        await this.prisma.idempotencyKey.deleteMany({
          where: { id: existing.id },
        });
      } else if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new UnprocessableEntityException(
            'Cette clé Idempotency-Key a déjà servi pour une autre requête.',
          );
        }
        if (existing.status !== 'COMPLETED') {
          throw new ConflictException(
            'Cette requête est déjà en cours de traitement. Réessayez dans un instant.',
          );
        }
        return { replay: true, body: existing.responseBody };
      }

      try {
        const created = await this.prisma.idempotencyKey.create({
          data: {
            userId,
            key,
            requestHash,
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          },
        });
        return { replay: false, id: created.id };
      } catch (error) {
        // Prise entre la lecture et l'écriture : on relit pour répondre juste.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
      }
    }

    throw new ConflictException(
      'Cette requête est déjà en cours de traitement. Réessayez dans un instant.',
    );
  }

  private async complete(id: string, body: unknown): Promise<void> {
    await this.prisma.idempotencyKey
      .update({
        where: { id },
        data: {
          status: 'COMPLETED',
          responseBody:
            body === undefined || body === null ? Prisma.JsonNull : (body as Prisma.InputJsonValue),
        },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Idempotence : réponse non mémorisée (${error instanceof Error ? error.message : String(error)})`,
        );
      });
  }

  private async release(id: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { id } }).catch(() => undefined);
  }
}

/** Rend une route idempotente via l'en-tête `Idempotency-Key`. */
export function Idempotent(): MethodDecorator {
  return applyDecorators(UseInterceptors(IdempotencyInterceptor));
}

/** Purge des clés expirées. Appelée par l'ordonnanceur. */
export async function purgeExpiredIdempotencyKeys(prisma: PrismaService): Promise<number> {
  const { count } = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}
