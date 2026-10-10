import type {
  AdminMaker,
  MakerCard,
  MakerPlanSummary,
  OwnMakerProfile,
  PublicMaker,
} from '@oja/contracts';
import type { City, Country, MakerProfile } from '@oja/db';

/**
 * Frontière public / privé des profils créateurs.
 *
 * Règle métier du cahier client : « Le client ne voit que les informations
 * publiques. » Le nom du responsable, le téléphone, l'e-mail, l'adresse,
 * l'IFU et le RCCM ne sortent **jamais** vers un client.
 *
 * Cette frontière est tenue par une fonction unique plutôt que par la
 * prudence de chaque contrôleur. Le jour où l'on ajoute un champ privé au
 * schéma, il ne peut pas fuiter par une route qu'on aurait oublié de
 * relire : il faudrait l'ajouter ici, explicitement.
 */

type MakerWithPlace = MakerProfile & {
  city: City & { country: Pick<Country, 'name'> };
};

/**
 * Ce que le mapper ne peut pas lire sur la ligne elle-même : la formule en
 * cours (une autre table) et la façon de transformer une clé de stockage en
 * URL affichable (un réglage du serveur).
 */
export interface MakerContext {
  productCount?: number;
  plan: MakerPlanSummary & { showBadge: boolean };
  imageUrl: (fileKey: string) => string;
}

export function toPublicMaker(maker: MakerWithPlace, context: MakerContext): PublicMaker {
  return {
    id: maker.id,
    slug: maker.slug,
    shopName: maker.shopName,
    description: maker.description,
    logoUrl: maker.logoUrl ? context.imageUrl(maker.logoUrl) : null,
    coverUrl: maker.coverUrl ? context.imageUrl(maker.coverUrl) : null,
    city: maker.city.name,
    country: maker.city.country.name,
    ratingAvg: maker.ratingAvg,
    ratingCount: maker.ratingCount,
    productCount: context.productCount ?? 0,
    creatorKind: maker.creatorKind,
    activityField: maker.activityField,
    specialties: maker.specialties,
    techniques: maker.techniques,
    services: maker.services,
    region: maker.region,
    publicArea: maker.publicArea,
    badge: context.plan.showBadge ? { code: context.plan.code, name: context.plan.name } : null,
  };
}

/** Carte d'annuaire : un sous-ensemble de la vue publique. */
export function toMakerCard(maker: MakerWithPlace, context: MakerContext): MakerCard {
  const full = toPublicMaker(maker, context);
  return {
    id: full.id,
    slug: full.slug,
    shopName: full.shopName,
    logoUrl: full.logoUrl,
    coverUrl: full.coverUrl,
    city: full.city,
    country: full.country,
    region: full.region,
    creatorKind: full.creatorKind,
    activityField: full.activityField,
    specialties: full.specialties,
    badge: full.badge,
    productCount: full.productCount,
  };
}

/** Vue administrateur : tout, y compris ce qui ne sort jamais côté client. */
export function toAdminMaker(maker: MakerWithPlace, context: MakerContext): AdminMaker {
  const { showBadge: _showBadge, ...plan } = context.plan;
  return {
    ...toPublicMaker(maker, context),
    userId: maker.userId,
    managerName: maker.managerName,
    contactPhone: maker.contactPhone,
    contactEmail: maker.contactEmail,
    postalAddress: maker.postalAddress,
    ifuNumber: maker.ifuNumber,
    rccmNumber: maker.rccmNumber,
    kycStatus: maker.kycStatus,
    kycSubmittedAt: maker.kycSubmittedAt?.toISOString() ?? null,
    kycReviewedAt: maker.kycReviewedAt?.toISOString() ?? null,
    kycRejectReason: maker.kycRejectReason,
    commissionBps: maker.commissionBps,
    plan,
  };
}

/**
 * Vue du créateur sur sa propre boutique.
 *
 * Elle ajoute à la vue administrateur les valeurs brutes dont son formulaire a
 * besoin. Ces champs restent hors de `toPublicMaker` : c'est bien le
 * propriétaire qui les lit, jamais un visiteur.
 */
export function toOwnMakerProfile(maker: MakerWithPlace, context: MakerContext): OwnMakerProfile {
  return {
    ...toAdminMaker(maker, context),
    cityId: maker.cityId,
    pickupLine1: maker.pickupLine1,
    pickupLandmark: maker.pickupLandmark,
    pickupLatitude: maker.pickupLatitude,
    pickupLongitude: maker.pickupLongitude,
  };
}

/**
 * Champs interdits de sortie publique. Exporté pour que les tests puissent
 * vérifier mécaniquement qu'aucun d'eux n'apparaît dans une réponse — un
 * contrôle plus fiable qu'une relecture.
 */
export const PRIVATE_MAKER_FIELDS = [
  'managerName',
  'contactPhone',
  'contactEmail',
  'postalAddress',
  'ifuNumber',
  'rccmNumber',
  'pickupLine1',
  'pickupLatitude',
  'pickupLongitude',
  'payoutMsisdn',
  'payoutBankIban',
] as const;
