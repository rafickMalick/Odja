/**
 * Livraison : distance, choix du véhicule, tarif.
 *
 * Le cahier des charges client demande un calcul au réel — « Le système choisit
 * automatiquement Moto / Tricycle / Camionnette selon dimensions, poids,
 * quantité, distance » — et non un forfait par zone.
 */

import type { Xof } from './pricing';

export type VehicleType = 'MOTO' | 'TRICYCLE' | 'CAMIONNETTE';

export class DeliveryError extends Error {}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_KM = 6371;

/**
 * Distance à vol d'oiseau, en kilomètres.
 *
 * Volontairement pas de distance routière en v1 : elle suppose une API
 * cartographique, donc un coût, une latence et une dépendance externe sur le
 * chemin du chiffrage. La correction est portée par le facteur de sinuosité
 * ci-dessous, et le remplacement se fera derrière la même signature.
 */
export function haversineKm(from: GeoPoint, to: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Distance facturable.
 *
 * Le vol d'oiseau sous-estime systématiquement le trajet réel en ville : un
 * facteur de sinuosité le corrige. 1,3 est la valeur retenue par défaut, à
 * recaler sur les premières courses réelles.
 */
export function billableDistanceKm(
  from: GeoPoint,
  to: GeoPoint,
  sinuosityFactor = 1.3,
): number {
  if (sinuosityFactor < 1) {
    throw new DeliveryError(
      `le facteur de sinuosité ne peut pas être inférieur à 1, reçu ${sinuosityFactor}`,
    );
  }
  return haversineKm(from, to) * sinuosityFactor;
}

/** Dimensions d'un article, telles que saisies sur la fiche produit. */
export interface ParcelItem {
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  quantity: number;
}

export interface ParcelLoad {
  totalWeightGrams: number;
  totalVolumeLitres: number;
  /** Plus grande dimension d'un article, en centimètres. Elle ne s'additionne
   *  pas : c'est celle qui doit tenir dans le véhicule. */
  longestSideCm: number;
}

export function measureLoad(items: ParcelItem[]): ParcelLoad {
  if (items.length === 0) {
    throw new DeliveryError('une livraison porte sur au moins un article');
  }

  let totalWeightGrams = 0;
  let totalVolumeMm3 = 0;
  let longestSideMm = 0;

  for (const item of items) {
    if (item.quantity < 1) {
      throw new DeliveryError(`quantité invalide : ${item.quantity}`);
    }
    totalWeightGrams += item.weightGrams * item.quantity;
    totalVolumeMm3 += item.lengthMm * item.widthMm * item.heightMm * item.quantity;
    longestSideMm = Math.max(longestSideMm, item.lengthMm, item.widthMm, item.heightMm);
  }

  return {
    totalWeightGrams,
    // 1 litre = 1 000 000 mm³
    totalVolumeLitres: totalVolumeMm3 / 1_000_000,
    longestSideCm: longestSideMm / 10,
  };
}

/** Grille tarifaire d'un véhicule, telle qu'elle vit en base. */
export interface VehicleRate {
  vehicle: VehicleType;
  baseFeeXof: Xof;
  perKmXof: Xof;
  minFeeXof: Xof;
  maxWeightKg: number;
  maxVolumeL: number;
  maxLengthCm: number;
}

export interface DeliveryQuote {
  vehicle: VehicleType;
  distanceKm: number;
  feeXof: Xof;
  load: ParcelLoad;
}

function feeFor(rate: VehicleRate, distanceKm: number): Xof {
  const raw = rate.baseFeeXof + Math.round(rate.perKmXof * distanceKm);
  return Math.max(raw, rate.minFeeXof);
}

export function fits(rate: VehicleRate, load: ParcelLoad): boolean {
  return (
    load.totalWeightGrams <= rate.maxWeightKg * 1000 &&
    load.totalVolumeLitres <= rate.maxVolumeL &&
    load.longestSideCm <= rate.maxLengthCm
  );
}

/**
 * Choisit le véhicule et calcule les frais.
 *
 * On retient **le moins cher parmi ceux qui peuvent porter la charge**, et non
 * simplement le plus petit véhicule compatible : sur une longue distance, un
 * tricycle au kilomètre bon marché peut revenir moins cher qu'une moto au
 * tarif de base plus élevé. Trier par capacité donnerait la mauvaise réponse.
 */
export function quoteDelivery(
  items: ParcelItem[],
  distanceKm: number,
  rates: VehicleRate[],
): DeliveryQuote {
  if (distanceKm < 0) {
    throw new DeliveryError(`distance négative : ${distanceKm}`);
  }
  if (rates.length === 0) {
    throw new DeliveryError('aucune grille tarifaire disponible pour ce pays');
  }

  const load = measureLoad(items);
  const eligible = rates.filter((rate) => fits(rate, load));

  if (eligible.length === 0) {
    throw new DeliveryError(
      `aucun véhicule ne peut porter cette commande ` +
        `(${(load.totalWeightGrams / 1000).toFixed(1)} kg, ` +
        `${load.totalVolumeLitres.toFixed(1)} L, ` +
        `${load.longestSideCm.toFixed(0)} cm) — la livraison doit être scindée`,
    );
  }

  let best = eligible[0]!;
  let bestFee = feeFor(best, distanceKm);

  for (const rate of eligible.slice(1)) {
    const fee = feeFor(rate, distanceKm);
    if (fee < bestFee) {
      best = rate;
      bestFee = fee;
    }
  }

  return {
    vehicle: best.vehicle,
    distanceKm,
    feeXof: bestFee,
    load,
  };
}
