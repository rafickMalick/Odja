import { ConfigService } from '@nestjs/config';
import type { PaymentProvider } from '@oja/domain';

import { KadevPayProvider } from './kadevpay.provider';
import { KkiapayProvider } from './kkiapay.provider';
import { SimulatedPaymentProvider } from './simulated.provider';

/**
 * Jeton d'injection du fournisseur de paiement actif.
 *
 * Le reste du code — `PaymentService`, le webhook, la vérification — ne
 * dépend que de l'interface `PaymentProvider`, jamais d'une classe concrète.
 * Basculer de `simulated` à `kkiapay` est un changement de configuration,
 * pas de code.
 */
export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER_TOKEN';

export const paymentProviderFactory = {
  provide: PAYMENT_PROVIDER,
  useFactory: (
    config: ConfigService,
    simulated: SimulatedPaymentProvider,
    kadevPay: KadevPayProvider,
    kkiapay: KkiapayProvider,
  ): PaymentProvider => {
    const selected = config.get<string>('PAYMENT_PROVIDER', 'simulated');
    if (selected === 'kkiapay') return kkiapay;
    return selected === 'kadevpay' ? kadevPay : simulated;
  },
  inject: [ConfigService, SimulatedPaymentProvider, KadevPayProvider, KkiapayProvider],
};
