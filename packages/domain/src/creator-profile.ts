/**
 * Profils créatifs et visibilité (cahier des évolutions, § 2 et § 3).
 *
 * Deux notions vivent côte à côte et ne doivent jamais se confondre :
 * le **statut** dit ce qu'est le créateur (artisan, designer, apprenti…),
 * la **formule** dit ce qu'il paie pour être vu. Un artisan Premium n'est pas
 * plus qualifié qu'un artisan Standard.
 */

export type CreatorKind =
  | 'STUDIO'
  | 'ARTISAN'
  | 'DESIGNER'
  | 'APPRENTICE_DESIGNER'
  | 'APPRENTICE_ARTISAN';

export const CREATOR_KIND_LABELS: Readonly<Record<CreatorKind, string>> = {
  STUDIO: 'Entreprise ou studio créatif',
  ARTISAN: 'Artisan',
  DESIGNER: 'Designer indépendant',
  APPRENTICE_DESIGNER: 'Apprenti designer',
  APPRENTICE_ARTISAN: 'Apprenti artisan',
};

/**
 * Statuts qu'un créateur peut choisir lui-même.
 *
 * Les statuts d'apprenti passent par un justificatif de formation et une
 * validation propre (§ 4.3 et 4.4) : ils ne s'ouvriront qu'avec ce circuit.
 */
export const SELF_SERVICE_CREATOR_KINDS: readonly CreatorKind[] = ['STUDIO', 'ARTISAN', 'DESIGNER'];

export function isApprentice(kind: CreatorKind): boolean {
  return kind === 'APPRENTICE_DESIGNER' || kind === 'APPRENTICE_ARTISAN';
}

// ═══════════════════════════════════════════ Coordonnées dans les textes publics

/**
 * Cherche des coordonnées directes dans un texte destiné au public.
 *
 * Ojà reste l'intermédiaire de toute vente : un numéro de téléphone, une
 * adresse e-mail ou un lien de messagerie dans une présentation permettraient
 * de traiter en dehors de la plateforme (§ 2.2 C). Renvoie la raison du refus,
 * ou `null` si le texte est publiable.
 *
 * Le repérage est volontairement prudent sur les nombres : « 120 x 80 cm »,
 * « depuis 1998 » ou « 25 ans » doivent passer. Seule une suite d'au moins
 * huit chiffres, éventuellement séparés par des espaces, points ou tirets, est
 * lue comme un numéro — c'est la longueur minimale d'un numéro béninois.
 */
export function findContactDetails(text: string): string | null {
  if (EMAIL.test(text)) {
    return 'Retirez l’adresse e-mail : les acheteurs vous contactent par Ojà.';
  }
  if (MESSAGING_LINK.test(text)) {
    return 'Retirez le lien de messagerie : les acheteurs vous contactent par Ojà.';
  }

  for (const match of text.matchAll(DIGIT_RUN)) {
    if (YEAR_RANGE.test(match[0].trim())) continue;
    if (match[0].replace(/\D/g, '').length >= 8) {
      return 'Retirez le numéro de téléphone : les acheteurs vous contactent par Ojà.';
    }
  }
  return null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/;
const MESSAGING_LINK = /\b(wa\.me|whatsapp|t\.me|telegram\.me|m\.me|signal\.me)\b/i;
/* Un chiffre, puis chiffres ou séparateurs courts. Le « + » initial couvre
   l'indicatif international (+229). */
const DIGIT_RUN = /\+?\d(?:[\d\s.\-()]*\d)?/g;
/** « 2024-2025 » compte huit chiffres sans être un numéro. */
const YEAR_RANGE = /^(19|20)\d{2}\s*[-.]\s*(19|20)\d{2}$/;

// ═══════════════════════════════════════════ Disponibilité affichée

export type ProductAvailability = 'AVAILABLE' | 'SOLD' | 'UNAVAILABLE';

/** Ce que le visiteur lit sur une réalisation de la galerie (§ 2.2 E). */
export type DisplayAvailability =
  | 'AVAILABLE'
  | 'MADE_TO_ORDER'
  | 'SOLD'
  | 'UNAVAILABLE'
  | 'PORTFOLIO';

export const DISPLAY_AVAILABILITY_LABELS: Readonly<Record<DisplayAvailability, string>> = {
  AVAILABLE: 'Disponible',
  MADE_TO_ORDER: 'Sur commande',
  SOLD: 'Vendu',
  UNAVAILABLE: 'Indisponible',
  PORTFOLIO: 'Réalisation',
};

export function displayAvailability(product: {
  isForSale: boolean;
  availability: ProductAvailability;
  isMadeToOrder: boolean;
  quantityAvailable: number;
  quantityReserved: number;
}): DisplayAvailability {
  if (!product.isForSale) return 'PORTFOLIO';
  if (product.availability === 'SOLD') return 'SOLD';
  if (product.availability === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (product.isMadeToOrder) return 'MADE_TO_ORDER';
  /* Une pièce en stock dont tout est réservé par des commandes en cours n'est
     plus achetable, sans être vendue pour autant. */
  return product.quantityAvailable - product.quantityReserved > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
}

/** Une fiche ne va au panier que si elle est à vendre et achetable maintenant. */
export function isPurchasable(product: Parameters<typeof displayAvailability>[0]): boolean {
  const state = displayAvailability(product);
  return state === 'AVAILABLE' || state === 'MADE_TO_ORDER';
}

// ═══════════════════════════════════════════ Formules de visibilité

export interface PlanLike {
  id: string;
  maxPublications: number | null;
}

export interface SubscriptionLike<P extends PlanLike = PlanLike> {
  startsAt: Date;
  endsAt: Date | null;
  cancelledAt: Date | null;
  plan: P;
}

/**
 * Souscription en cours à une date donnée, s'il y en a une.
 *
 * Quand deux périodes se chevauchent (un renouvellement anticipé), la plus
 * récemment commencée l'emporte : c'est celle que l'administration vient
 * d'accorder.
 */
export function activeSubscription<S extends SubscriptionLike>(
  subscriptions: readonly S[],
  now: Date,
): S | null {
  let current: S | null = null;
  for (const subscription of subscriptions) {
    if (subscription.cancelledAt) continue;
    if (subscription.startsAt > now) continue;
    if (subscription.endsAt && subscription.endsAt <= now) continue;
    if (!current || subscription.startsAt > current.startsAt) current = subscription;
  }
  return current;
}

/**
 * Peut-on créer une fiche de plus ?
 *
 * Les archives ne comptent pas : un créateur qui retire une pièce de la vente
 * libère sa place. Renvoie le message à afficher, ou `null`.
 */
export function publicationQuotaProblem(
  activeCount: number,
  maxPublications: number | null,
  planName: string,
): string | null {
  if (maxPublications === null || activeCount < maxPublications) return null;
  return (
    `Votre formule ${planName} permet ${maxPublications} fiches actives, et vous les avez atteintes. ` +
    'Archivez une fiche ou passez à une formule supérieure.'
  );
}
