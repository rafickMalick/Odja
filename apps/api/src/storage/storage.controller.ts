import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import {
  requestUploadSchema,
  UPLOAD_RULES,
  type RequestUploadInput,
  type UploadTicket,
} from '@oja/contracts';

import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { zodBody } from '../common/zod.pipe';
import { StorageService } from './storage.service';

/**
 * Demande d'autorisation d'envoi.
 *
 * Le client demande une URL signée, envoie son fichier directement au
 * stockage, puis rattache la clé obtenue à une fiche produit ou à un dossier.
 * En trois temps, sans que l'API voie passer un seul octet.
 */
@Controller('uploads')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('ticket')
  async ticket(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(requestUploadSchema)) input: RequestUploadInput,
  ): Promise<UploadTicket> {
    /* Le rôle décide de ce qu'on peut envoyer. Sans ce contrôle, n'importe
       quel client obtiendrait une autorisation d'écriture sur l'espace des
       photos produit. */
    assertAllowed(user.role, input.purpose);

    return this.storage.createUploadTicket(input, { userId: user.id });
  }
}

/** Qui a le droit d'envoyer quoi. */
const ALLOWED: Record<string, readonly string[]> = {
  'product-image': ['MAKER', 'ADMIN'],
  'shop-image': ['MAKER', 'ADMIN'],
  'kyc-document': ['MAKER', 'COURIER', 'ADMIN'],
  'delivery-proof': ['COURIER', 'ADMIN'],
  'dispute-evidence': ['CUSTOMER', 'MAKER', 'ADMIN'],
  'support-attachment': ['CUSTOMER', 'MAKER', 'ADMIN'],
  /* Un organisateur d'exposition n'est pas forcément un créateur inscrit
     (§ 6.2, parcours B) : un compte client suffit pour monter un dossier. */
  'exhibition-image': ['CUSTOMER', 'MAKER', 'ADMIN'],
  'exhibition-document': ['CUSTOMER', 'MAKER', 'ADMIN'],
};

function assertAllowed(role: string, purpose: keyof typeof UPLOAD_RULES): void {
  const roles = ALLOWED[purpose] ?? [];
  if (!roles.includes(role)) {
    // 404 plutôt que 403, comme partout ailleurs : on ne confirme pas
    // l'existence d'une capacité à qui n'y a pas droit.
    throw new NotFoundException();
  }
}
