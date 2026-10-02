import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import {
  contactMessageSchema,
  type ContactMessageInput,
  type ContactReceipt,
} from '@oja/contracts';

import { Public } from '../auth/decorators/public.decorator';
import { Throttle } from '../common/rate-limit.guard';
import { zodBody } from '../common/zod.pipe';
import { SupportService } from './support.service';

/**
 * Formulaire de contact public (cahier L6-13).
 *
 * Ouvert à tous, inscrits ou non : le message devient une demande dans la
 * file du service client, marquée « formulaire de contact ».
 *
 * Deux protections, sans compte externe ni clé à configurer :
 *   · **limite d'envois** : 5 par heure et par adresse ;
 *   · **piège à robots** : le champ `website`, invisible pour un humain. S'il
 *     est rempli, la requête « réussit » sans rien créer : le robot ne
 *     comprend pas qu'il a été repéré, et n'essaie pas de contourner.
 */
@Controller('contact')
export class ContactController {
  private readonly logger = new Logger(ContactController.name);

  constructor(private readonly support: SupportService) {}

  @Public()
  @Throttle(5, 3_600)
  @Post()
  @HttpCode(201)
  async send(
    @Body(zodBody(contactMessageSchema)) input: ContactMessageInput,
  ): Promise<ContactReceipt | { reference: null }> {
    if (input.website?.trim()) {
      this.logger.warn('Formulaire de contact : piège à robots déclenché, message ignoré');
      return { reference: null };
    }
    return this.support.createFromContact(input);
  }
}
