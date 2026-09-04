import { describe, expect, it } from 'vitest';

import {
  billableDistanceKm,
  DeliveryError,
  fits,
  haversineKm,
  measureLoad,
  quoteDelivery,
  type VehicleRate,
} from './delivery';

const ABIDJAN = { latitude: 5.36, longitude: -4.0083 };
const BOUAKE = { latitude: 7.6906, longitude: -5.03 };
const COCODY = { latitude: 5.3599, longitude: -3.9855 };

/* Grille de référence, cohérente avec le seed. */
const RATES: VehicleRate[] = [
  {
    vehicle: 'MOTO',
    baseFeeXof: 1_000,
    perKmXof: 150,
    minFeeXof: 1_000,
    maxWeightKg: 30,
    maxVolumeL: 80,
    maxLengthCm: 80,
  },
  {
    vehicle: 'TRICYCLE',
    baseFeeXof: 2_500,
    perKmXof: 120,
    minFeeXof: 2_500,
    maxWeightKg: 250,
    maxVolumeL: 900,
    maxLengthCm: 200,
  },
  {
    vehicle: 'CAMIONNETTE',
    baseFeeXof: 6_000,
    perKmXof: 250,
    minFeeXof: 6_000,
    maxWeightKg: 1_200,
    maxVolumeL: 6_000,
    maxLengthCm: 320,
  },
];

const item = (over: Partial<Parameters<typeof measureLoad>[0][0]> = {}) => ({
  weightGrams: 2_000,
  lengthMm: 400,
  widthMm: 300,
  heightMm: 200,
  quantity: 1,
  ...over,
});

describe('haversineKm', () => {
  it('mesure Abidjan → Bouaké autour de 280 km', () => {
    expect(haversineKm(ABIDJAN, BOUAKE)).toBeGreaterThan(270);
    expect(haversineKm(ABIDJAN, BOUAKE)).toBeLessThan(295);
  });

  it('rend zéro sur deux points confondus', () => {
    expect(haversineKm(ABIDJAN, ABIDJAN)).toBe(0);
  });

  it('est symétrique', () => {
    expect(haversineKm(ABIDJAN, BOUAKE)).toBeCloseTo(haversineKm(BOUAKE, ABIDJAN), 6);
  });
});

describe('billableDistanceKm', () => {
  it('majore le vol d’oiseau — en ville, la route n’est jamais droite', () => {
    const direct = haversineKm(ABIDJAN, COCODY);
    expect(billableDistanceKm(ABIDJAN, COCODY)).toBeCloseTo(direct * 1.3, 6);
  });

  it('refuse un facteur inférieur à 1, qui sous-facturerait', () => {
    expect(() => billableDistanceKm(ABIDJAN, COCODY, 0.9)).toThrow(DeliveryError);
  });
});

describe('measureLoad', () => {
  it('additionne poids et volume, mais retient la plus grande dimension', () => {
    const load = measureLoad([
      item({ lengthMm: 400, quantity: 2 }),
      item({ lengthMm: 1_500, weightGrams: 10_000 }),
    ]);

    expect(load.totalWeightGrams).toBe(14_000);
    // (400×300×200)×2 + (1500×300×200) = 48 000 000 + 90 000 000 mm³
    expect(load.totalVolumeLitres).toBeCloseTo(138, 6);
    // Une dimension ne s'additionne pas : c'est la plus longue qui doit tenir.
    expect(load.longestSideCm).toBe(150);
  });

  it('refuse une livraison sans article', () => {
    expect(() => measureLoad([])).toThrow(DeliveryError);
  });
});

describe('quoteDelivery', () => {
  it('retient la moto pour un petit colis en ville', () => {
    const result = quoteDelivery([item()], 8, RATES);
    expect(result.vehicle).toBe('MOTO');
    expect(result.feeXof).toBe(1_000 + 150 * 8); // 2 200
  });

  it('écarte la moto dès que la charge dépasse sa capacité', () => {
    // Un fauteuil : 35 kg, donc au-delà des 30 kg de la moto.
    const result = quoteDelivery([item({ weightGrams: 35_000 })], 8, RATES);
    expect(result.vehicle).toBe('TRICYCLE');
  });

  it('écarte la moto sur une pièce trop longue, même légère', () => {
    const result = quoteDelivery([item({ weightGrams: 4_000, lengthMm: 1_800 })], 5, RATES);
    expect(result.vehicle).toBe('TRICYCLE');
  });

  it('retient le MOINS CHER des véhicules capables, pas le plus petit', () => {
    // Sur 100 km, la moto coûte 1 000 + 15 000 = 16 000 ; le tricycle
    // 2 500 + 12 000 = 14 500. Le tricycle gagne alors qu'il est plus grand.
    const result = quoteDelivery([item()], 100, RATES);
    expect(result.vehicle).toBe('TRICYCLE');
    expect(result.feeXof).toBe(14_500);
  });

  it('applique le tarif plancher sur une course très courte', () => {
    const result = quoteDelivery([item()], 0, RATES);
    expect(result.feeXof).toBe(1_000);
  });

  it('refuse clairement une commande qu’aucun véhicule ne peut porter', () => {
    expect(() =>
      quoteDelivery([item({ weightGrams: 2_000_000 })], 10, RATES),
    ).toThrow(/aucun véhicule|scindée/);
  });

  it('refuse une distance négative', () => {
    expect(() => quoteDelivery([item()], -1, RATES)).toThrow(DeliveryError);
  });

  it('refuse un pays sans grille tarifaire', () => {
    expect(() => quoteDelivery([item()], 10, [])).toThrow(/grille tarifaire/);
  });
});

describe('fits', () => {
  it('vérifie les trois capacités indépendamment', () => {
    const moto = RATES[0]!;
    expect(fits(moto, measureLoad([item()]))).toBe(true);
    expect(fits(moto, measureLoad([item({ weightGrams: 31_000 })]))).toBe(false);
    expect(fits(moto, measureLoad([item({ lengthMm: 900 })]))).toBe(false);
  });
});
