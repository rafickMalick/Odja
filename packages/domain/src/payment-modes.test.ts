import { describe, expect, it } from 'vitest';

import { allocateBalance, needsOnlinePayment, splitPayment } from './payment-modes';

describe('splitPayment', () => {
  it('paiement en ligne : tout maintenant', () => {
    expect(splitPayment(108_000, 'ONLINE_FULL')).toEqual({ upfrontXof: 108_000, balanceXof: 0 });
  });

  it('paiement à la livraison : rien maintenant', () => {
    expect(splitPayment(108_000, 'CASH_ON_DELIVERY')).toEqual({
      upfrontXof: 0,
      balanceXof: 108_000,
    });
  });

  it('acompte : la moitié maintenant, le reste à la réception', () => {
    expect(splitPayment(108_000, 'DEPOSIT_50')).toEqual({
      upfrontXof: 54_000,
      balanceXof: 54_000,
    });
  });

  it('acompte sur un total impair : le franc en trop est payé d\'avance', () => {
    expect(splitPayment(10_001, 'DEPOSIT_50')).toEqual({ upfrontXof: 5_001, balanceXof: 5_000 });
  });

  it('la somme vaut toujours le total', () => {
    for (const total of [1, 2, 3, 999, 10_001, 123_457]) {
      for (const mode of ['ONLINE_FULL', 'DEPOSIT_50', 'CASH_ON_DELIVERY'] as const) {
        const { upfrontXof, balanceXof } = splitPayment(total, mode);
        expect(upfrontXof + balanceXof).toBe(total);
      }
    }
  });

  it('refuse un total qui n\'est pas un entier positif', () => {
    expect(() => splitPayment(0, 'ONLINE_FULL')).toThrow();
    expect(() => splitPayment(10.5, 'DEPOSIT_50')).toThrow();
  });
});

describe('needsOnlinePayment', () => {
  it('seul le paiement à la livraison se passe de paiement en ligne', () => {
    expect(needsOnlinePayment('ONLINE_FULL')).toBe(true);
    expect(needsOnlinePayment('DEPOSIT_50')).toBe(true);
    expect(needsOnlinePayment('CASH_ON_DELIVERY')).toBe(false);
  });
});

describe('allocateBalance', () => {
  it('une seule sous-commande reçoit tout le solde', () => {
    expect(allocateBalance(54_000, [100_000])).toEqual([54_000]);
  });

  it('partage au prorata des poids', () => {
    expect(allocateBalance(60_000, [30_000, 90_000])).toEqual([15_000, 45_000]);
  });

  it('la somme des parts vaut exactement le solde, sans franc perdu', () => {
    const weights = [33_333, 33_333, 33_334];
    for (const balance of [1, 2, 100, 99_999, 100_001]) {
      const shares = allocateBalance(balance, weights);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(balance);
      expect(shares.every((share) => Number.isInteger(share) && share >= 0)).toBe(true);
    }
  });

  it('un solde nul donne des parts nulles', () => {
    expect(allocateBalance(0, [10, 20])).toEqual([0, 0]);
  });

  it('sans poids exploitable, répartit à parts égales', () => {
    const shares = allocateBalance(10, [0, 0, 0]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('liste vide', () => {
    expect(allocateBalance(100, [])).toEqual([]);
  });
});
