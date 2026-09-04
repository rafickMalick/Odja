/**
 * Contrat d'un fournisseur de paiement.
 *
 * Le module paiement se réduit à cette interface. Deux implémentations la
 * respectent : un fournisseur **simulé**, qui permet de dérouler tout le
 * parcours — commande, fabrication, livraison, validation, versement — sans
 * agrégateur, et le fournisseur réel, branché au dernier lot. Le reste du code
 * ne connaît que cette interface et ne changera pas d'une ligne.
 */

export type PaymentChannel = 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER';

export interface InitiatePayment {
  /** Notre identifiant, transmis au fournisseur et renvoyé par le webhook. */
  paymentId: string;
  orderReference: string;
  amountXof: number;
  channel: PaymentChannel;
  customer: { fullName: string; email: string; phone: string };
  callbackUrl: string;
}

export interface CheckoutConfig {
  /** Ce que le front doit présenter : widget, redirection, ou rien en simulé. */
  mode: 'widget' | 'redirect' | 'simulated';
  publicKey?: string;
  redirectUrl?: string;
  amountXof: number;
}

export interface InitiatedPayment {
  reference: string;
  checkout: CheckoutConfig;
}

export type ProviderPaymentStatus =
  | { status: 'pending' }
  | {
      status: 'paid';
      /** Montant réellement encaissé — à comparer au montant attendu. */
      amountXof: number;
      /** Net après frais du fournisseur. */
      netAmountXof: number;
      feeXof: number;
      currency: string;
      paidAt: Date;
    }
  | { status: 'failed'; code: string; message: string };

export interface WebhookEvent {
  reference: string;
  paymentId: string | null;
  eventType: string;
  status: ProviderPaymentStatus;
}

export interface PaymentProvider {
  readonly name: string;

  initiate(input: InitiatePayment): Promise<InitiatedPayment>;

  /** Vérification serveur à serveur, seule source de vérité avec le webhook. */
  verify(reference: string): Promise<ProviderPaymentStatus>;

  /**
   * Analyse un webhook.
   *
   * Prend le **corps brut**, jamais un objet déjà désérialisé : la signature
   * se vérifie sur les octets reçus. Une re-sérialisation JSON change
   * l'espacement ou l'ordre des clés, et la vérification échoue.
   */
  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent;
}
