import { z } from 'zod';

import { phoneSchema } from './auth';
import type { OwnReviewView } from './reviews';

/**
 * Contrats du panier, des adresses et du passage de commande.
 *
 * Décision produit actée : **quand un panier réunit des pièces de plusieurs
 * ateliers, chaque atelier donne lieu à une livraison distincte**, donc à ses
 * propres frais. C'est la réalité du terrain — deux ateliers, deux
 * enlèvements — et le client doit le voir avant de payer, pas le découvrir sur
 * sa facture.
 */

// ═══════════════════════════════════════════ Panier

export const addToCartSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(99).default(1),
});
export type AddToCartInput = z.infer<typeof addToCartSchema>;

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(99),
});

export interface CartLine {
  id: string;
  productId: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  quantity: number;

  /**
   * Le prix affiché au client, commission Ojà comprise. Le détail
   * prix créateur / commission ne quitte jamais le back-office : le client
   * n'a pas à voir la marge de la plateforme.
   */
  finalPriceXof: number;
  lineTotalXof: number;

  /** Ce qu'on peut réellement commander aujourd'hui. */
  available: number;
  isMadeToOrder: boolean;
  leadTimeDays: number | null;
  /** Renseigné quand la ligne n'est plus commandable telle quelle. */
  issue: string | null;
}

export interface CartMakerGroup {
  makerId: string;
  makerSlug: string;
  shopName: string;
  city: string;
  lines: CartLine[];
  itemsFinalSubtotalXof: number;
}

export interface CartView {
  id: string;
  /** Un groupe par atelier : chacun sera livré séparément. */
  groups: CartMakerGroup[];
  itemCount: number;
  itemsFinalTotalXof: number;
  /** Vrai dès qu'une ligne n'est plus commandable. */
  hasIssues: boolean;
}

// ═══════════════════════════════════════════ Adresses

export const addressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  cityId: z.string().min(1, 'Ville requise'),
  line1: z.string().trim().min(4, 'Adresse requise').max(300),
  /** « En face de la pharmacie » — c'est ce dont le livreur se sert. */
  landmark: z.string().trim().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressSchema>;

export interface PublicAddress {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  /** Nom de la ville, pour l'affichage. */
  city: string;
  /** Identifiant de la ville — nécessaire pour rééditer l'adresse. */
  cityId: string;
  line1: string;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
}

// ═══════════════════════════════════════════ Chiffrage

export const quoteSchema = z.object({
  addressId: z.string().min(1, 'Adresse de livraison requise'),
  /** Code promo à appliquer au chiffrage. Invalide ⇒ signalé dans `blockers`. */
  promoCode: z.string().trim().toUpperCase().min(3).max(40).optional(),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export interface DeliveryQuoteLine {
  makerId: string;
  shopName: string;
  /** Moto, tricycle ou camionnette, choisi automatiquement. */
  vehicle: 'MOTO' | 'TRICYCLE' | 'CAMIONNETTE';
  distanceKm: number;
  feeXof: number;
  etaMinDays: number;
  etaMaxDays: number;
}

/** Les trois façons de régler une commande. Voir `splitPayment` (domaine). */
export const PAYMENT_MODE_VALUES = ['ONLINE_FULL', 'DEPOSIT_50', 'CASH_ON_DELIVERY'] as const;
export type PaymentModeName = (typeof PAYMENT_MODE_VALUES)[number];

/** Ce que le client paierait selon le mode choisi — affiché avant de confirmer. */
export interface PaymentOption {
  mode: PaymentModeName;
  label: string;
  /** À payer en ligne maintenant. */
  upfrontXof: number;
  /** À remettre au livreur à la réception. */
  balanceXof: number;
}

export interface CheckoutQuote {
  cart: CartView;
  /** Une livraison par atelier — décision produit assumée. */
  deliveries: DeliveryQuoteLine[];

  itemsFinalTotalXof: number;
  deliveryTotalXof: number;
  vatXof: number;
  /** Remise d'un code promo, déjà retranchée de `totalXof`. */
  discountXof: number;
  /**
   * Code appliqué et son libellé, `null` si aucun (ou code refusé).
   * `capped` : la remise a été ramenée à la commission Ojà — le libellé
   * (« -20 % ») annonce plus que ce qui est réellement retranché.
   */
  promo: { code: string; label: string; capped: boolean } | null;
  totalXof: number;

  /** Modes de règlement possibles et ce que chacun fait payer maintenant. */
  paymentOptions: PaymentOption[];

  /** Ce qui empêche encore de commander, s'il y a lieu. */
  blockers: string[];
}

export const placeOrderSchema = z.object({
  addressId: z.string().min(1, 'Adresse de livraison requise'),
  /** Le client confirme le total qu'on lui a affiché. Voir la note ci-dessous. */
  expectedTotalXof: z.number().int().positive(),
  /** Le même code qu'au chiffrage. Réévalué côté serveur avant l'engagement. */
  promoCode: z.string().trim().toUpperCase().min(3).max(40).optional(),
  /** Mode de règlement. Absent : tout en ligne, comme avant. */
  paymentMode: z.enum(PAYMENT_MODE_VALUES).default('ONLINE_FULL'),
});
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

export const verifyPaymentSchema = z.object({
  /**
   * Référence Kadev Pay apprise côté navigateur (`onSuccess`, voir
   * `openKadevPayCheckout`). Optionnelle : sans elle, la vérification se fait
   * avec la référence déjà connue du serveur — celle qu'un webhook aurait
   * corrigée, s'il en est arrivé un.
   */
  providerRef: z.string().trim().min(1).max(200).optional(),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

// ═══════════════════════════════════════════ Commande

export type OrderStatusName =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'PREPARING'
  | 'IN_DELIVERY'
  | 'DELIVERED'
  | 'VALIDATED'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface OrderLineView {
  id: string;
  productName: string;
  /** Pour revenir à la fiche, si la pièce est encore en ligne. */
  productSlug: string;
  quantity: number;
  /** Prix affiché au client, commission comprise — jamais le détail. */
  finalPriceXof: number;
  lineTotalXof: number;
  /** Réception validée et pas encore d'avis : le client peut noter la pièce. */
  canReview: boolean;
  review: OwnReviewView | null;
}

export interface SubOrderView {
  reference: string;
  shopName: string;
  status: string;
  statusLabel: string;
  lines: OrderLineView[];
  deliveryFeeXof: number;
  vehicle: string | null;
  dueReadyAt: string | null;
  /** Référence de l'expédition, dès qu'elle existe — sert au suivi en direct. */
  shipmentReference: string | null;
  /**
   * Livreur affecté : « Koffi A. », son véhicule et sa note. Jamais son
   * téléphone — les coordonnées ne circulent pas, le client passe par le
   * support Ojà.
   */
  courier: { displayName: string; vehicle: string; ratingAvg: number } | null;
  /** Part à remettre au livreur à la réception de cette sous-commande. */
  balanceDueXof: number;
  /** Vrai une fois que le livreur a déclaré avoir encaissé cette part. */
  cashCollected: boolean;
}

export interface OrderView {
  id: string;
  reference: string;
  status: OrderStatusName;
  statusLabel: string;

  shipFullName: string;
  shipPhone: string;
  shipLine1: string;
  shipLandmark: string | null;

  /** Une sous-commande par atelier, livrée séparément. */
  subOrders: SubOrderView[];

  itemsFinalTotalXof: number;
  deliveryTotalXof: number;
  vatXof: number;
  /** Remise d'un code promo, déjà retranchée de `totalXof`. */
  discountXof: number;
  /** Code promo utilisé, figé sur la commande. */
  promoCode: string | null;
  totalXof: number;

  paymentMode: PaymentModeName;
  /** Part payée en ligne à la commande. */
  upfrontXof: number;
  /** Part à remettre au livreur à la réception. */
  balanceXof: number;

  placedAt: string | null;
  createdAt: string;

  /** Présent dès que la commande est payée : facture téléchargeable. */
  hasInvoice?: boolean;

  /**
   * Configuration d'encaissement, présente uniquement à la création — tant
   * qu'il reste quelque chose à payer. `GET /orders/:reference` ne la renvoie
   * pas : un client qui revient sur une commande déjà payée n'a plus de
   * widget à afficher, il a une commande à suivre.
   */
  checkout?: PaymentCheckoutConfig;
}

/**
 * Ce que le front doit présenter pour encaisser.
 *
 * `widget` : charger le script de l'agrégateur et lui passer `publicKey` —
 * aucune information sensible n'y transite, c'est la clé publique.
 * `simulated` : rien à afficher, le développement encaisse depuis le
 * back-office. `redirect` existe pour un agrégateur qui fonctionnerait par
 * renvoi de page plutôt que par script embarqué — non utilisé par Kadev Pay.
 */
export interface PaymentCheckoutConfig {
  mode: 'widget' | 'redirect' | 'simulated';
  publicKey?: string;
  redirectUrl?: string;
  amountXof: number;
  /** Référence à transmettre au widget, et que le webhook renverra. */
  reference: string;
}

// ═══════════════════════════════════════════ Facture

/**
 * Réponse de `GET /orders/:reference/invoice`.
 *
 * On ne renvoie **jamais** le PDF directement : une URL pré-signée à durée
 * courte, la même mécanique que les pièces KYC.
 */
export interface InvoiceView {
  number: string;
  issuedAt: string;
  /** URL de téléchargement, valable quelques minutes. */
  url: string;
}
