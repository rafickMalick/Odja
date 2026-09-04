/**
 * Statut de la commande, dérivé de ses sous-commandes.
 *
 * Le client suit **une** commande ; les ateliers travaillent chacun sur la
 * leur. Le statut affiché au client est donc calculé, jamais saisi — sinon les
 * deux vues divergent au premier atelier qui prend de l'avance.
 *
 * Fonction pure : elle se teste exhaustivement, sans base.
 */

import type { OrderStatus, SubOrderStatus } from './states';

/**
 * Règle de dérivation, par ordre de priorité :
 *
 *   1. tout refusé ou annulé      → la commande est annulée ;
 *   2. tout validé par le client  → terminée ;
 *   3. tout livré                 → livrée ;
 *   4. au moins un en livraison   → en livraison ;
 *   5. tout prêt à récupérer      → en préparation ;
 *   6. au moins un en fabrication → en fabrication ;
 *   7. sinon                      → confirmée.
 *
 * Le principe : **on affiche l'étape la moins avancée qui reste à franchir.**
 * Annoncer « livrée » quand un seul des deux colis est arrivé ferait mentir la
 * commande, et le client appellerait le support.
 */
export function deriveOrderStatus(
  subOrderStatuses: readonly SubOrderStatus[],
  paid: boolean,
): OrderStatus {
  if (subOrderStatuses.length === 0) {
    return paid ? 'CONFIRMED' : 'PENDING_PAYMENT';
  }

  const active = subOrderStatuses.filter(
    (status) => status !== 'REJECTED' && status !== 'CANCELLED',
  );

  // Plus aucun atelier ne suit : il n'y a plus de commande.
  if (active.length === 0) return 'CANCELLED';

  if (!paid) return 'PENDING_PAYMENT';

  const every = (status: SubOrderStatus) => active.every((s) => s === status);
  const some = (...statuses: SubOrderStatus[]) =>
    active.some((s) => statuses.includes(s));

  if (every('VALIDATED')) return 'COMPLETED';
  if (active.every((s) => s === 'DELIVERED' || s === 'VALIDATED')) return 'DELIVERED';
  if (some('IN_DELIVERY')) return 'IN_DELIVERY';
  if (every('READY_FOR_PICKUP')) return 'PREPARING';
  if (some('IN_PRODUCTION')) return 'IN_PRODUCTION';

  return 'CONFIRMED';
}

/**
 * L'atelier doit-il passer par une phase de fabrication ?
 *
 * Une pièce en stock est prête tout de suite ; une pièce faite sur commande
 * ouvre un compte à rebours. Une sous-commande qui mélange les deux passe par
 * la fabrication — c'est la plus lente qui commande le rythme.
 */
export function needsProduction(
  lines: readonly { isMadeToOrder: boolean }[],
): boolean {
  return lines.some((line) => line.isMadeToOrder);
}

/**
 * Délai de fabrication de la sous-commande : le plus long de ses pièces.
 *
 * Le maximum et non la somme — un atelier ne fabrique pas ses pièces l'une
 * après l'autre, et de toute façon elles partent ensemble.
 */
export function productionDaysFor(
  lines: readonly { isMadeToOrder: boolean; leadTimeDays: number | null }[],
): number {
  return lines.reduce(
    (longest, line) =>
      line.isMadeToOrder ? Math.max(longest, line.leadTimeDays ?? 0) : longest,
    0,
  );
}
