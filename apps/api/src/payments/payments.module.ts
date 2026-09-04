import { Module } from '@nestjs/common';

import { LedgerService } from '../ledger/ledger.service';
import { KadevPayProvider } from './kadevpay.provider';
import { paymentProviderFactory, PAYMENT_PROVIDER } from './payment-provider.factory';
import { PaymentService } from './payment.service';
import { SimulatedPaymentProvider } from './simulated.provider';
import { WebhookController } from './webhook.controller';

/**
 * Tout ce qui touche à l'encaissement, en un seul module.
 *
 * Cette isolation existait de fait — le dossier `payments/` — mais pas dans
 * la structure NestJS : ses classes étaient déclarées à même `OrdersModule`.
 * Ça marchait tant qu'un seul appelant en avait besoin. Le webhook et le
 * chiffrage en ont désormais besoin chacun de son côté ; sans module dédié,
 * ils auraient fini par déclarer deux instances distinctes du même
 * fournisseur, ou par créer un import circulaire entre `orders` et
 * `checkout`.
 */
@Module({
  controllers: [WebhookController],
  providers: [
    LedgerService,
    SimulatedPaymentProvider,
    KadevPayProvider,
    paymentProviderFactory,
    PaymentService,
  ],
  exports: [PaymentService, SimulatedPaymentProvider, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
