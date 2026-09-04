import type { AdminMaker, OwnMakerProfile, PublicMaker } from '@oja/contracts';
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

export function toPublicMaker(maker: MakerWithPlace, productCount = 0): PublicMaker {
  return {
    id: maker.id,
    slug: maker.slug,
    shopName: maker.shopName,
    description: maker.description,
    logoUrl: maker.logoUrl,
    coverUrl: maker.coverUrl,
    city: maker.city.name,
    country: maker.city.country.name,
    ratingAvg: maker.ratingAvg,
    ratingCount: maker.ratingCount,
    productCount,
  };
}

/** Vue administrateur : tout, y compris ce qui ne sort jamais côté client. */
export function toAdminMaker(maker: MakerWithPlace, productCount = 0): AdminMaker {
  return {
    ...toPublicMaker(maker, productCount),
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
  };
}

/**
 * Vue du créateur sur sa propre boutique.
 *
 * Elle ajoute à la vue administrateur les valeurs brutes dont son formulaire a
 * besoin. Ces champs restent hors de `toPublicMaker` : c'est bien le
 * propriétaire qui les lit, jamais un visiteur.
 */
export function toOwnMakerProfile(maker: MakerWithPlace, productCount = 0): OwnMakerProfile {
  return {
    ...toAdminMaker(maker, productCount),
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
