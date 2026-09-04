import { describe, expect, it } from 'vitest';

import {
  commissionFor,
  PricingError,
  priceLine,
  quote,
  refundAmountFor,
} from './pricing';

describe('commissionFor', () => {
  it("s'ajoute au prix du créateur, elle ne s'en déduit pas", () => {
    // L'exemple du cahier des charges client : le créateur affiche 100 000 F,
    // il touchera 100 000 F, et le client paiera 105 000 F.
    expect(commissionFor(100_000, 500)).toBe(5_000);
  });

  it('arrondit à l’entier inférieur, au bénéfice du client', () => {
    // 3 333 × 5 % = 166,65 → 166, et non 167.
    expect(commissionFor(3_333, 500)).toBe(166);
  });

  it('rend zéro sur un taux nul', () => {
    expect(commissionFor(100_000, 0)).toBe(0);
  });

  it('refuse un prix non entier — le XOF n’a pas de décimale', () => {
    expect(() => commissionFor(100.5, 500)).toThrow(PricingError);
  });

  it('refuse un prix négatif', () => {
    expect(() => commissionFor(-1, 500)).toThrow(/négatif/);
  });
});

describe('priceLine', () => {
  it('décompose la ligne comme la fiche produit l’affiche', () => {
    const line = priceLine({
      productId: 'p1',
      productName: 'Fauteuil galbé Lagune',
      makerPriceXof: 100_000,
      commissionBps: 500,
      quantity: 2,
    });

    expect(line.makerPriceXof).toBe(100_000); // « Prix du créateur »
    expect(line.commissionXof).toBe(5_000); //   « Commission OJÀ »
    expect(line.finalPriceXof).toBe(105_000); // « Prix final »

    expect(line.lineTotalXof).toBe(210_000); // ce que le client paie
    expect(line.lineMakerTotalXof).toBe(200_000); // ce que le créateur touche
    expect(line.lineCommissionXof).toBe(10_000);
  });

  it('vérifie l’identité prix final = prix créateur + commission', () => {
    for (const price of [1, 999, 3_333, 7_777, 100_000, 1_234_567]) {
      const line = priceLine({
        productId: 'p',
        productName: 'x',
        makerPriceXof: price,
        commissionBps: 500,
        quantity: 1,
      });
      expect(line.finalPriceXof).toBe(line.makerPriceXof + line.commissionXof);
      expect(line.lineTotalXof).toBe(line.finalPriceXof * line.quantity);
    }
  });

  it('calcule la commission par unité, pas sur le total de la ligne', () => {
    // À 3 333 F et 5 %, l'unité donne 166 F (×3 = 498). Le total donnerait
    // floor(9 999 × 5 %) = 499. On retient 498 : c'est le prix que le client a
    // vu sur la fiche, multiplié par la quantité.
    const line = priceLine({
      productId: 'p',
      productName: 'x',
      makerPriceXof: 3_333,
      commissionBps: 500,
      quantity: 3,
    });
    expect(line.lineCommissionXof).toBe(498);
    expect(Math.floor((3_333 * 3 * 500) / 10_000)).toBe(499); // l'autre méthode
  });

  it('refuse une quantité nulle', () => {
    expect(() =>
      priceLine({
        productId: 'p',
        productName: 'x',
        makerPriceXof: 1_000,
        commissionBps: 500,
        quantity: 0,
      }),
    ).toThrow(/au moins 1/);
  });
});

describe('quote', () => {
  const line = (makerPriceXof: number, quantity = 1) => ({
    productId: 'p',
    productName: 'x',
    makerPriceXof,
    commissionBps: 500,
    quantity,
  });

  it('reproduit l’exemple chiffré du document d’alignement', () => {
    const result = quote({
      groups: [{ makerId: 'm1', lines: [line(100_000)], deliveryFeeXof: 3_000 }],
    });

    expect(result.itemsMakerTotalXof).toBe(100_000); // dû au créateur
    expect(result.commissionTotalXof).toBe(5_000); //   part Ojà
    expect(result.itemsFinalTotalXof).toBe(105_000);
    expect(result.deliveryTotalXof).toBe(3_000);
    expect(result.totalXof).toBe(108_000); // ce que le client paie
  });

  it('éclate un panier par créateur, chacun avec sa livraison', () => {
    const result = quote({
      groups: [
        { makerId: 'm1', lines: [line(50_000, 2)], deliveryFeeXof: 2_000 },
        { makerId: 'm2', lines: [line(30_000)], deliveryFeeXof: 1_500 },
      ],
    });

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]!.itemsMakerSubtotalXof).toBe(100_000);
    expect(result.groups[1]!.itemsMakerSubtotalXof).toBe(30_000);

    expect(result.itemsMakerTotalXof).toBe(130_000);
    expect(result.commissionTotalXof).toBe(6_500);
    expect(result.deliveryTotalXof).toBe(3_500);
    expect(result.totalXof).toBe(140_000);
  });

  it('ne fait jamais apparaître ni disparaître un franc', () => {
    const result = quote({
      groups: [
        { makerId: 'm1', lines: [line(3_333, 3), line(7_777)], deliveryFeeXof: 2_500 },
        { makerId: 'm2', lines: [line(999, 7)], deliveryFeeXof: 1_000 },
      ],
    });

    // Le total facturé se recompose exactement à partir de ses parts.
    expect(result.itemsFinalTotalXof).toBe(
      result.itemsMakerTotalXof + result.commissionTotalXof,
    );
    expect(result.totalXof).toBe(
      result.itemsFinalTotalXof + result.deliveryTotalXof + result.vatXof,
    );

    // Et à partir de chaque ligne, une à une.
    const fromLines = result.groups
      .flatMap((g) => g.lines)
      .reduce((total, l) => total + l.lineTotalXof, 0);
    expect(fromLines).toBe(result.itemsFinalTotalXof);
  });

  it('laisse la TVA à zéro tant qu’elle n’est pas activée', () => {
    const result = quote({
      groups: [{ makerId: 'm1', lines: [line(100_000)], deliveryFeeXof: 3_000 }],
    });
    expect(result.vatXof).toBe(0);
  });

  it('applique la TVA sur les articles et la livraison quand elle est activée', () => {
    const result = quote({
      groups: [{ makerId: 'm1', lines: [line(100_000)], deliveryFeeXof: 3_000 }],
      vatBps: 1_800,
    });
    expect(result.vatXof).toBe(19_440); // 18 % de 108 000
    expect(result.totalXof).toBe(127_440);
  });

  it('refuse un chiffrage vide', () => {
    expect(() => quote({ groups: [] })).toThrow(PricingError);
  });
});

describe('refundAmountFor', () => {
  it('rembourse 100 % du prix produit, jamais la commission ni la livraison', () => {
    // Règle du cahier client : « seul le prix du produit est remboursé ; les
    // frais de livraison et la commission restent acquis ».
    const result = quote({
      groups: [{ makerId: 'm1', lines: [
        { productId: 'p', productName: 'x', makerPriceXof: 100_000, commissionBps: 500, quantity: 1 },
      ], deliveryFeeXof: 3_000 }],
    });

    const refund = refundAmountFor(result.groups[0]!.lines);

    expect(refund).toBe(100_000);
    // Ojà conserve la commission et la livraison : 8 000 F sur 108 000 encaissés.
    expect(result.totalXof - refund).toBe(8_000);
  });
});
