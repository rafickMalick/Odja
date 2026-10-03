/**
 * Modes de paiement d'une commande.
 *
 *   · ONLINE_FULL      tout est payé en ligne, à la commande ;
 *   · DEPOSIT_50       la moitié en ligne maintenant, le solde remis au
 *                      livreur à la réception ;
 *   · CASH_ON_DELIVERY rien en ligne, tout est remis au livreur à la réception.
 *
 * Le livreur encaisse **pour Ojà** et lui reverse : l'argent ne va jamais
 * directement à l'atelier, qui reste payé par la plateforme après validation
 * du client, comme pour un paiement en ligne.
 *
 * Fonctions pures : c'est du calcul d'argent, il se teste sans base.
 */

export type PaymentMode = 'ONLINE_FULL' | 'DEPOSIT_50' | 'CASH_ON_DELIVERY';

export const PAYMENT_MODES: readonly PaymentMode[] = [
  'ONLINE_FULL',
  'DEPOSIT_50',
  'CASH_ON_DELIVERY',
];

export const PAYMENT_MODE_LABELS: Readonly<Record<PaymentMode, string>> = {
  ONLINE_FULL: 'Payer maintenant',
  DEPOSIT_50: 'Acompte de 50 % maintenant, le reste à la réception',
  CASH_ON_DELIVERY: 'Payer à la livraison',
};

export interface PaymentSplit {
  /** À payer en ligne, à la commande. */
  upfrontXof: number;
  /** À remettre au livreur, à la réception. */
  balanceXof: number;
}

/**
 * Répartit le total entre ce qui se paie maintenant et ce qui se paie à la
 * livraison.
 *
 * L'acompte est arrondi **au franc supérieur** : sur un total impair, c'est
 * Ojà qui détient un franc de plus d'avance, pas le client qui en doit un de
 * plus à la porte. `upfront + balance` vaut toujours exactement le total.
 */
export function splitPayment(totalXof: number, mode: PaymentMode): PaymentSplit {
  if (!Number.isInteger(totalXof) || totalXof <= 0) {
    throw new Error(`total invalide : ${totalXof}`);
  }

  switch (mode) {
    case 'ONLINE_FULL':
      return { upfrontXof: totalXof, balanceXof: 0 };
    case 'DEPOSIT_50': {
      const upfrontXof = Math.ceil(totalXof / 2);
      return { upfrontXof, balanceXof: totalXof - upfrontXof };
    }
    case 'CASH_ON_DELIVERY':
      return { upfrontXof: 0, balanceXof: totalXof };
  }
}

/** Vrai si une partie du prix se règle en ligne à la commande. */
export function needsOnlinePayment(mode: PaymentMode): boolean {
  return mode !== 'CASH_ON_DELIVERY';
}

/**
 * Partage le solde entre les sous-commandes, au prorata de leur poids.
 *
 * Chaque atelier a sa propre livraison, donc son propre livreur, qui encaisse
 * sa part. Méthode du plus grand reste : la somme des parts vaut **exactement**
 * le solde, sans franc perdu ni créé par l'arrondi.
 */
export function allocateBalance(balanceXof: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  if (balanceXof <= 0) return weights.map(() => 0);

  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (totalWeight <= 0) {
    // Aucun poids exploitable : répartition égale, le reste au premier.
    const base = Math.floor(balanceXof / weights.length);
    const shares = weights.map(() => base);
    shares[0] = (shares[0] ?? 0) + (balanceXof - base * weights.length);
    return shares;
  }

  const exact = weights.map((weight) => (Math.max(0, weight) * balanceXof) / totalWeight);
  const shares = exact.map((value) => Math.floor(value));
  let remaining = balanceXof - shares.reduce((sum, share) => sum + share, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of byRemainder) {
    if (remaining <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    remaining -= 1;
  }

  return shares;
}
