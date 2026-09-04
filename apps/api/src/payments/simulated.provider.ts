import { Injectable, Logger } from '@nestjs/common';
import type {
  InitiatePayment,
  InitiatedPayment,
  PaymentProvider,
  ProviderPaymentStatus,
  WebhookEvent,
} from '@oja/domain';

/**
 * Fournisseur de paiement simulé.
 *
 * Il permet de dérouler tout le parcours — commande, fabrication, livraison,
 * validation, versement — sans attendre l'agrégateur. Une route
 * d'administration marque le paiement comme confirmé, exactement comme le
 * ferait un webhook réel : **le même chemin de traitement, les mêmes
 * écritures comptables**. Quand l'agrégateur arrivera, seule cette classe
 * changera.
 *
 * Il **refuse de fonctionner en production** : un système qui encaisse pour
 * de faux sans le dire est pire qu'un système qui ne démarre pas.
 */
@Injectable()
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = 'simulated';

  private readonly logger = new Logger(SimulatedPaymentProvider.name);

  /** Ce que le fournisseur « a encaissé », alimenté par la route de test. */
  private readonly confirmed = new Map<string, ProviderPaymentStatus>();

  /** Frais simulés : 2,3 %, l'ordre de grandeur du Mobile Money local. */
  private static readonly FEE_BPS = 230;

  async initiate(input: InitiatePayment): Promise<InitiatedPayment> {
    const reference = `SIM-${Date.now()}-${input.paymentId.slice(-6)}`;

    this.logger.log(
      `[paiement simulé] ${reference} — ${input.amountXof} F CFA pour ${input.orderReference}`,
    );

    return {
      reference,
      checkout: {
        mode: 'simulated',
        amountXof: input.amountXof,
      },
    };
  }

  async verify(reference: string): Promise<ProviderPaymentStatus> {
    return this.confirmed.get(reference) ?? { status: 'pending' };
  }

  parseWebhook(): WebhookEvent {
    // Le fournisseur simulé n'émet pas de webhook : la confirmation passe par
    // la route d'administration, qui rejoint ensuite le même traitement.
    throw new Error("Le fournisseur simulé n'émet pas de webhook.");
  }

  /**
   * Simule l'encaissement. Appelée par la route de test, jamais par le métier.
   */
  markPaid(reference: string, amountXof: number): ProviderPaymentStatus {
    const feeXof = Math.floor((amountXof * SimulatedPaymentProvider.FEE_BPS) / 10_000);

    const status: ProviderPaymentStatus = {
      status: 'paid',
      amountXof,
      netAmountXof: amountXof - feeXof,
      feeXof,
      currency: 'XOF',
      paidAt: new Date(),
    };

    this.confirmed.set(reference, status);
    return status;
  }

  markFailed(reference: string, message: string): void {
    this.confirmed.set(reference, { status: 'failed', code: 'SIMULATED', message });
  }
}
