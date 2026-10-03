import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma, type UserRole } from '@oja/db';
import type { Request } from 'express';
import { Observable, from, map, switchMap } from 'rxjs';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { redactValue } from './redact';

/**
 * Journal d'audit automatique (backlog L0-31).
 *
 * Toute action d'administration **réussie** — une requête qui modifie
 * (POST, PUT, PATCH, DELETE) sur une route réservée `@Roles('ADMIN')` — est
 * écrite au journal, sans que le service ait à y penser. Jusqu'ici chaque
 * service le faisait à la main : une action oubliée ne laissait aucune trace,
 * et on ne s'en apercevait qu'en cherchant qui avait fait quoi.
 *
 * Les écritures manuelles restent : elles portent l'avant et l'après
 * **métier** (statut d'un dossier, montant d'un arbitrage). Celle-ci garantit
 * le plancher — qui, quand, quelle route, quel objet, depuis quelle adresse —
 * sous l'action `http.<MÉTHODE> <route>`. Le corps de la requête y figure,
 * secrets masqués.
 *
 * Un échec d'écriture au journal ne fait jamais échouer l'action, déjà
 * faite : il est signalé dans les journaux de l'API.
 */

export const NO_AUDIT_KEY = 'oja:no-audit';

/** Exclut une route de l'audit automatique (lecture déguisée en POST, bruit). */
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Au-delà, le corps est résumé : le journal n'est pas un entrepôt de fichiers. */
const MAX_BODY_CHARS = 4_000;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (!MUTATING.has(request.method)) return next.handle();

    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    const skipped = this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, targets);
    if (skipped || !roles?.includes('ADMIN') || !request.user) return next.handle();

    const user = request.user;
    return next.handle().pipe(
      switchMap((body) => from(this.record(request, user)).pipe(map(() => body))),
    );
  }

  private async record(
    request: Request & { user?: AuthenticatedUser },
    user: AuthenticatedUser,
  ): Promise<void> {
    const route = routeOf(request);
    const params = request.params ?? {};
    const targetId = Object.values(params)[0] ?? '-';

    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: user.role,
          action: `http.${request.method} ${route}`,
          targetType: targetTypeOf(route),
          targetId: String(targetId),
          after: {
            params: redactValue(params),
            body: summarize(redactValue(request.body ?? null)),
          } as Prisma.InputJsonValue,
          ip: request.ip ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Audit automatique non écrit pour ${request.method} ${route} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** `/api/v1/admin/makers/:id/approve` → `/admin/makers/:id/approve`. */
function routeOf(request: Request): string {
  const pattern = (request.route as { path?: string } | undefined)?.path ?? request.path;
  return pattern.replace(/^\/api\/v\d+/, '');
}

/** `/admin/makers/:id/approve` → `makers`, l'objet que vise la route. */
function targetTypeOf(route: string): string {
  const segments = route.split('/').filter((segment) => segment && !segment.startsWith(':'));
  return (segments[0] === 'admin' ? segments[1] : segments[0]) ?? 'route';
}

function summarize(body: unknown): unknown {
  const text = JSON.stringify(body) ?? 'null';
  return text.length <= MAX_BODY_CHARS ? body : { tronqué: text.slice(0, MAX_BODY_CHARS) };
}
