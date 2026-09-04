import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@oja/db';

import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Contrôle de profil.
 *
 * **Un accès refusé renvoie `404`, jamais `403`** — règle du § 2.1 du cahier.
 * Un `403` confirmerait que la ressource existe : c'est ainsi qu'on énumère
 * les commandes des autres, ou qu'on découvre qu'une route d'administration
 * est là. Un `404` ne dit rien.
 *
 * Ce garde ne couvre que le profil. La **propriété** de la ressource — cette
 * commande appartient-elle bien à ce client ? — se vérifie dans le service,
 * qui seul sait de quelle ressource il s'agit. Voir `assertOwnership`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user || !required.includes(user.role)) {
      throw new NotFoundException();
    }

    return true;
  }
}

/**
 * Vérifie qu'une ressource appartient bien à celui qui la demande.
 *
 * À appeler dans chaque service qui manipule une ressource nominative. Elle
 * lève un `404` pour la même raison que ci-dessus : un client qui demande la
 * commande d'un autre doit recevoir exactement la réponse qu'il recevrait pour
 * une commande inexistante.
 *
 * Un administrateur passe toujours.
 */
export function assertOwnership(
  user: AuthenticatedUser,
  resourceOwnerId: string | null | undefined,
): void {
  if (user.role === 'ADMIN') return;
  if (!resourceOwnerId || resourceOwnerId !== user.id) {
    throw new NotFoundException();
  }
}
