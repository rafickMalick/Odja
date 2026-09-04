/**
 * Machines à états.
 *
 * Le cahier des charges client nomme les statuts vus par chaque profil. Ces
 * libellés sont repris tels quels : ce sont les mots que le créateur, le client
 * et le livreur liront à l'écran, et ils ne doivent pas être reformulés.
 *
 * Règle d'or : aucun statut ne change par affectation directe. Toute transition
 * passe par `assertTransition`, qui refuse ce que le métier interdit.
 */

export class TransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
    readonly allowed: readonly string[],
  ) {
    super(
      `transition interdite sur ${entity} : ${from} → ${to}. ` +
        (allowed.length > 0
          ? `Depuis ${from}, seuls ${allowed.join(', ')} sont possibles.`
          : `${from} est un état terminal.`),
    );
  }
}

function assertTransition<S extends string>(
  entity: string,
  graph: Readonly<Record<S, readonly S[]>>,
  from: S,
  to: S,
): void {
  const allowed = graph[from];
  if (!allowed.includes(to)) {
    throw new TransitionError(entity, from, to, allowed);
  }
}

// ═══════════════════════════════════════════ Commande — vue client

export type OrderStatus =
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

/** Libellés du cahier client, affichés au client. */
export const ORDER_LABELS: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: 'En attente de paiement',
  CONFIRMED: 'Commande confirmée',
  IN_PRODUCTION: 'En fabrication',
  PREPARING: 'En préparation',
  IN_DELIVERY: 'En livraison',
  DELIVERED: 'Livrée',
  VALIDATED: 'Réception validée',
  COMPLETED: 'Terminée',
  DISPUTED: 'Problème signalé',
  CANCELLED: 'Annulée',
  REFUNDED: 'Remboursée',
};

const ORDER_GRAPH: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PRODUCTION', 'PREPARING', 'CANCELLED'],
  IN_PRODUCTION: ['PREPARING', 'CANCELLED'],
  PREPARING: ['IN_DELIVERY', 'CANCELLED'],
  IN_DELIVERY: ['DELIVERED'],
  // Le client valide, ou signale un problème. C'est le seul embranchement qui
  // décide du sort de l'argent.
  DELIVERED: ['VALIDATED', 'DISPUTED'],
  // COMPLETED n'arrive qu'après le versement au créateur, 24 h plus tard.
  VALIDATED: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['REFUNDED', 'COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  assertTransition('la commande', ORDER_GRAPH, from, to);
}

export function orderCanTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_GRAPH[from].includes(to);
}

// ═══════════════════════════════════════════ Sous-commande — vue créateur

export type SubOrderStatus =
  | 'RECEIVED'
  | 'PAYMENT_CONFIRMED'
  | 'IN_PRODUCTION'
  | 'READY_FOR_PICKUP'
  | 'IN_DELIVERY'
  | 'DELIVERED'
  | 'VALIDATED'
  | 'REJECTED'
  | 'CANCELLED';

/** Libellés du cahier client, affichés au créateur. */
export const SUB_ORDER_LABELS: Readonly<Record<SubOrderStatus, string>> = {
  RECEIVED: 'Commande reçue',
  PAYMENT_CONFIRMED: 'Paiement confirmé',
  IN_PRODUCTION: 'En fabrication',
  READY_FOR_PICKUP: 'Prêt à récupérer',
  IN_DELIVERY: 'En cours de livraison',
  DELIVERED: 'Livré',
  VALIDATED: 'Validé par le client',
  REJECTED: 'Refusée',
  CANCELLED: 'Annulée',
};

const SUB_ORDER_GRAPH: Readonly<Record<SubOrderStatus, readonly SubOrderStatus[]>> = {
  RECEIVED: ['PAYMENT_CONFIRMED', 'REJECTED', 'CANCELLED'],
  // Un produit en stock passe directement à « Prêt à récupérer » ; un produit
  // fabriqué sur commande passe par « En fabrication ».
  PAYMENT_CONFIRMED: ['IN_PRODUCTION', 'READY_FOR_PICKUP', 'REJECTED', 'CANCELLED'],
  IN_PRODUCTION: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['IN_DELIVERY', 'CANCELLED'],
  IN_DELIVERY: ['DELIVERED'],
  DELIVERED: ['VALIDATED'],
  VALIDATED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function assertSubOrderTransition(from: SubOrderStatus, to: SubOrderStatus): void {
  assertTransition('la sous-commande', SUB_ORDER_GRAPH, from, to);
}

// ═══════════════════════════════════════════ Expédition — vue livreur

export type ShipmentStatus =
  | 'TO_PICK_UP'
  | 'PICKED_UP'
  | 'IN_DELIVERY'
  | 'DELIVERED'
  | 'RETURN_REQUIRED'
  | 'RETURNED'
  | 'FAILED';

/** Libellés du cahier client, affichés au livreur. */
export const SHIPMENT_LABELS: Readonly<Record<ShipmentStatus, string>> = {
  TO_PICK_UP: 'À récupérer',
  PICKED_UP: 'Récupéré',
  IN_DELIVERY: 'En livraison',
  DELIVERED: 'Livré',
  RETURN_REQUIRED: 'Produit à retourner',
  RETURNED: 'Retourné',
  FAILED: 'Échec de livraison',
};

const SHIPMENT_GRAPH: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  TO_PICK_UP: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['IN_DELIVERY', 'FAILED'],
  IN_DELIVERY: ['DELIVERED', 'FAILED'],
  // « Livré » est basculé par la confirmation du client, pas par le livreur.
  // Si le client signale un problème, le livreur voit « produit à retourner ».
  DELIVERED: ['RETURN_REQUIRED'],
  RETURN_REQUIRED: ['RETURNED'],
  RETURNED: [],
  FAILED: ['TO_PICK_UP'],
};

export function assertShipmentTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  assertTransition("l'expédition", SHIPMENT_GRAPH, from, to);
}

// ═══════════════════════════════════════════ Échéances

/**
 * Le versement au créateur est libéré **24 heures après la validation de la
 * réception par le client** (règle métier du cahier client).
 */
export function payoutReleaseAt(validatedAt: Date, holdHours = 24): Date {
  return new Date(validatedAt.getTime() + holdHours * 3_600_000);
}

/**
 * Validation automatique si le client ne clique jamais.
 *
 * Le cahier client ne prévoit pas ce cas ; sans échéance, un client passif
 * priverait le créateur de son paiement indéfiniment. 72 h par défaut, à
 * confirmer (SPEC-ALIGNEMENT § 9, point A).
 */
export function autoValidateAt(deliveredAt: Date, hours = 72): Date {
  return new Date(deliveredAt.getTime() + hours * 3_600_000);
}

/**
 * Échéance de réponse du créateur à une nouvelle commande. Le silence vaut
 * refus (SPEC-ALIGNEMENT § 9, point D).
 */
export function subOrderRespondByAt(receivedAt: Date, hours = 48): Date {
  return new Date(receivedAt.getTime() + hours * 3_600_000);
}

/** Fin de fabrication attendue, sur le délai saisi à la fiche produit. */
export function productionDueAt(startedAt: Date, leadTimeDays: number): Date {
  return new Date(startedAt.getTime() + leadTimeDays * 86_400_000);
}
