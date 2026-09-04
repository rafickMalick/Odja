import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@oja/db';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  sessionId: string;
}

/** Injecte l'utilisateur authentifié dans une méthode de contrôleur. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      // Signe d'une route oubliée par le garde global, pas d'une erreur client.
      throw new Error(
        'CurrentUser utilisé sur une route sans authentification — vérifiez le garde',
      );
    }
    return request.user;
  },
);
