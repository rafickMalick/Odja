import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { TokenService } from '../token.service';

/**
 * Garde global : **toute route est fermée sauf mention contraire**.
 *
 * Le jeton est lu dans un cookie `httpOnly`, avec l'en-tête `Authorization` en
 * secours pour les outils et les tests. Le cookie est le canal normal : un
 * jeton en `localStorage` est lisible par n'importe quel script injecté, ce
 * que le § 11 du cahier écarte explicitement.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractToken(request);

    /* Une route publique reste ouverte, mais on identifie quand même le
       porteur d'une session valide.
     *
     * Sans cela, une route ouverte ne peut pas savoir qui la consulte : le
     * panier attribuait un panier anonyme à un client pourtant connecté, et
     * son contenu se perdait d'une requête à l'autre. Un jeton absent ou
     * invalide n'est pas une erreur ici — on continue en visiteur. */
    if (isPublic) {
      if (token) {
        try {
          const payload = await this.tokens.verifyAccess(token);
          const session = await this.tokens.activeSession(payload.sid);
          if (session) {
            request.user = {
              id: payload.sub,
              role: payload.role,
              sessionId: payload.sid,
              mfa: session.mfaVerified,
            };
          }
        } catch {
          // Visiteur non identifié : c'est un cas normal sur une route ouverte.
        }
      }
      return true;
    }

    if (!token) throw new UnauthorizedException('Authentification requise.');

    const payload = await this.tokens.verifyAccess(token);

    /* Le JWT est signé et non expiré — mais la session a pu être révoquée
       entre-temps (déconnexion, mot de passe changé, compte suspendu). Sans ce
       contrôle, un jeton reste utilisable jusqu'à 15 minutes après une
       déconnexion, ce qui vide la déconnexion de son sens. */
    const session = await this.tokens.activeSession(payload.sid);
    if (!session) throw new UnauthorizedException('Session fermée. Reconnectez-vous.');

    request.user = {
      id: payload.sub,
      role: payload.role,
      sessionId: payload.sid,
      mfa: session.mfaVerified,
    };
    return true;
  }
}

function extractToken(request: Request): string | null {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  const fromCookie = cookies?.['oja_access'];
  if (fromCookie) return fromCookie;

  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  return null;
}
