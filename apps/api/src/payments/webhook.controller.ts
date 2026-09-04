import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../auth/decorators/public.decorator';
import { Throttle } from '../common/rate-limit.guard';
import { PaymentService } from './payment.service';

/**
 * Réception des notifications Kadev Pay.
 *
 * Publique par nécessité — l'agrégateur n'a pas de session Ojà — mais
 * authentifiée par la signature, vérifiée à l'intérieur de
 * `PaymentService.handleWebhook`, sur le **corps brut** conservé par
 * `rawBody: true` (posé une fois pour toutes dans `main.ts`).
 *
 * Toujours `200`, y compris quand rien n'a été fait : un `4xx` ou un `5xx`
 * pousse l'agrégateur à réessayer indéfiniment une notification qui ne
 * passera jamais, ce qui n'aide personne. Seule l'authenticité de la
 * signature reste bloquante — elle seule protège contre une fausse
 * notification qui déclencherait un versement.
 */
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly payments: PaymentService) {}

  /* Cent appels par quart d'heure et par adresse : très au-dessus de ce
     qu'un flux de notifications légitime produit, largement en-dessous de ce
     qu'un balayage de force brute sur la signature demanderait pour être
     rentable. */
  @Public()
  @Throttle(100, 900)
  @Post('kadevpay')
  @HttpCode(200)
  async kadevpay(@Req() request: RawBodyRequest<Request>): Promise<{ status: string }> {
    const signature = request.headers['x-kadevpay-signature'];
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));

    return this.payments.handleWebhook(
      rawBody,
      typeof signature === 'string' ? signature : undefined,
    );
  }
}
