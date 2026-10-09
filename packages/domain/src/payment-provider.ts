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
  /** Le widget doit s'ouvrir en mode test : aucun argent réel ne bouge. */
  sandbox?: boolean;
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
      /**
       * Notre identifiant de paiement, tel que le fournisseur l'a enregistré
       * sur la transaction — quand il le conserve. Sans lui, rien n'empêche de
       * présenter la transaction d'une commande pour en confirmer une autre
       * du même montant : `PaymentService` le compare à celui qu'il confirme.
       */
      paymentId?: string | null;
    }
  | { status: 'failed'; code: string; message: string };

export interface WebhookEvent {
  reference: string;
  paymentId: string | null;
  eventType: string;
  status: ProviderPaymentStatus;
  /**
   * Empreinte stockée à la place de l'en-tête de signature, pour l'unicité de
   * `PaymentEvent`. Nécessaire quand l'en-tête est un secret partagé, identique
   * d'une notification à l'autre : il ne doit pas être écrit en base, et ne
   * distinguerait de toute façon pas deux notifications.
   */
  dedupeKey?: string;
}

export interface PaymentProvider {
  readonly name: string;

  /**
   * Le webhook n'est qu'un signal : le statut qu'il annonce est relu auprès du
   * fournisseur avant d'être appliqué. Pour un fournisseur dont le webhook ne
   * porte qu'un secret partagé (pas de signature du corps), c'est ce qui
   * empêche une notification forgée — ou un secret qui aurait fuité — de
   * confirmer une commande.
   */
  readonly verifiesWebhooks?: boolean;

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
