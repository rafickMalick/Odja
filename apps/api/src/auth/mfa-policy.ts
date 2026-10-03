import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UserRole } from '@oja/db';

/**
 * Qui doit avoir la double authentification (cahier L0-22).
 *
 * Isolé dans un fournisseur à part pour que les tests qui la vérifient
 * puissent l'imposer, alors que `vitest.config.ts` la coupe pour tous les
 * autres (`ADMIN_MFA_REQUIRED=false`) : sans cela, chaque test qui passe par
 * l'espace admin devrait d'abord activer un TOTP.
 */
@Injectable()
export class MfaPolicy {
  readonly adminRequired: boolean;

  constructor(config: ConfigService) {
    this.adminRequired = config.get<boolean>('ADMIN_MFA_REQUIRED', true);
  }

  isRequiredFor(role: UserRole): boolean {
    return role === 'ADMIN' && this.adminRequired;
  }
}
