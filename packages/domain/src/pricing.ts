/**
 * Calcul de prix.
 *
 * Règle centrale, issue du cahier des charges client : **la commission Ojà
 * s'ajoute au prix fixé par le créateur, elle ne s'en déduit pas.** Le créateur
 * touche exactement son prix ; le client paie ce prix plus la commission, qui
 * lui est affichée. Voir SPEC-ALIGNEMENT § 1.
 *
 *   prix créateur   100 000  ← ce que le créateur reçoit
 *   commission 5 %  + 5 000  ← part Ojà, visible du client
 *   ────────────────────────
 *   prix final      105 000  ← ce que le client paie
 *
 * Tous les montants sont des **entiers en franc CFA**. Le XOF n'a pas de
 * sous-unité d'usage : aucun flottant n'entre ici, jamais.
 */

/** Montant entier en franc CFA. */
export type Xof = number;

/** Taux en points de base : 500 = 5 %. */
export type Bps = number;

export const BPS_DENOMINATOR = 10_000;

export class PricingError extends Error {}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new PricingError(`${label} doit être un entier, reçu ${value}`);
  }
  if (value < 0) {
    throw new PricingError(`${label} ne peut pas être négatif, reçu ${value}`);
  }
}

/**
 * Commission sur un prix créateur.
 *
 * Arrondi **à l'entier inférieur** : l'écart d'arrondi reste donc chez Ojà
 * plutôt que d'être facturé au client. C'est le sens qui protège le client,
 * et c'est celui que le cahier retient.
 */
export function commissionFor(makerPriceXof: Xof, commissionBps: Bps): Xof {
  assertPositiveInteger(makerPriceXof, 'le prix du créateur');
  assertPositiveInteger(commissionBps, 'le taux de commission');
  return Math.floor((makerPriceXof * commissionBps) / BPS_DENOMINATOR);
}

export interface PricedLineInput {
  productId: string;
  productName: string;
  makerPriceXof: Xof;
  commissionBps: Bps;
  quantity: number;
}

export interface PricedLine {
  productId: string;
  productName: string;
  quantity: number;
  /** Ce que le créateur recevra, par unité. */
  makerPriceXof: Xof;
  commissionBps: Bps;
  /** Part Ojà, par unité. */
  commissionXof: Xof;
  /** makerPriceXof + commissionXof — le « prix final » de la fiche produit. */
  finalPriceXof: Xof;
  /** finalPriceXof × quantity — ce que la ligne coûte au client. */
  lineTotalXof: Xof;
  /** makerPriceXof × quantity — ce que la ligne rapporte au créateur. */
  lineMakerTotalXof: Xof;
  /** commissionXof × quantity. */
  lineCommissionXof: Xof;
}

/**
 * La commission est calculée **par unité puis multipliée**, et non sur le
 * total de la ligne. Les deux diffèrent dès que l'arrondi mord : à 3 333 F et
 * 5 %, l'unité donne 166 F (×3 = 498) là où le total donnerait 499 F. On retient
 * l'unité parce que c'est ce prix-là que le client a vu sur la fiche produit —
 * une facture qui ne se recompose pas à partir des prix affichés est
 * incontestablement fausse aux yeux de celui qui la lit.
 */
export function priceLine(input: PricedLineInput): PricedLine {
  assertPositiveInteger(input.quantity, 'la quantité');
  if (input.quantity < 1) {
    throw new PricingError(`la quantité doit être au moins 1, reçu ${input.quantity}`);
  }

  const commissionXof = commissionFor(input.makerPriceXof, input.commissionBps);
  const finalPriceXof = input.makerPriceXof + commissionXof;

  return {
    productId: input.productId,
    productName: input.productName,
    quantity: input.quantity,
    makerPriceXof: input.makerPriceXof,
    commissionBps: input.commissionBps,
    commissionXof,
    finalPriceXof,
    lineTotalXof: finalPriceXof * input.quantity,
    lineMakerTotalXof: input.makerPriceXof * input.quantity,
    lineCommissionXof: commissionXof * input.quantity,
  };
}

export interface MakerGroupInput {
  makerId: string;
  lines: PricedLineInput[];
  /** Frais de livraison de cette sous-commande, calculés séparément. */
  deliveryFeeXof: Xof;
}

export interface PricedMakerGroup {
  makerId: string;
  lines: PricedLine[];
  /** Somme due au créateur — versée en entier après validation du client. */
  itemsMakerSubtotalXof: Xof;
  commissionSubtotalXof: Xof;
  itemsFinalSubtotalXof: Xof;
  deliveryFeeXof: Xof;
}

export interface QuoteInput {
  groups: MakerGroupInput[];
  /** TVA du pays de livraison. Reste à 0 tant que la décision fiscale n'est
   *  pas prise (SPEC-ALIGNEMENT § 5). */
  vatBps?: Bps;
}

export interface Quote {
  groups: PricedMakerGroup[];
  /** Total dû aux créateurs. */
  itemsMakerTotalXof: Xof;
  /** Total encaissé par Ojà au titre de la commission. */
  commissionTotalXof: Xof;
  /** Ce que le client paie pour les articles. */
  itemsFinalTotalXof: Xof;
  deliveryTotalXof: Xof;
  vatXof: Xof;
  /** Ce que le client paie en tout. */
  totalXof: Xof;
}

/**
 * Chiffrage complet d'un panier, éclaté par créateur.
 *
 * Un panier peut réunir les pièces de plusieurs ateliers : chaque groupe
 * devient une sous-commande, avec sa propre livraison et son propre versement.
 */
export function quote(input: QuoteInput): Quote {
  if (input.groups.length === 0) {
    throw new PricingError('un chiffrage porte sur au moins un créateur');
  }

  const groups: PricedMakerGroup[] = input.groups.map((group) => {
    if (group.lines.length === 0) {
      throw new PricingError(`le créateur ${group.makerId} n'a aucune ligne`);
    }
    assertPositiveInteger(group.deliveryFeeXof, 'les frais de livraison');

    const lines = group.lines.map(priceLine);
    const itemsMakerSubtotalXof = sum(lines, (l) => l.lineMakerTotalXof);
    const commissionSubtotalXof = sum(lines, (l) => l.lineCommissionXof);

    return {
      makerId: group.makerId,
      lines,
      itemsMakerSubtotalXof,
      commissionSubtotalXof,
      itemsFinalSubtotalXof: itemsMakerSubtotalXof + commissionSubtotalXof,
      deliveryFeeXof: group.deliveryFeeXof,
    };
  });

  const itemsMakerTotalXof = sum(groups, (g) => g.itemsMakerSubtotalXof);
  const commissionTotalXof = sum(groups, (g) => g.commissionSubtotalXof);
  const itemsFinalTotalXof = itemsMakerTotalXof + commissionTotalXof;
  const deliveryTotalXof = sum(groups, (g) => g.deliveryFeeXof);

  const vatBps = input.vatBps ?? 0;
  const vatXof = Math.floor(((itemsFinalTotalXof + deliveryTotalXof) * vatBps) / BPS_DENOMINATOR);

  return {
    groups,
    itemsMakerTotalXof,
    commissionTotalXof,
    itemsFinalTotalXof,
    deliveryTotalXof,
    vatXof,
    totalXof: itemsFinalTotalXof + deliveryTotalXof + vatXof,
  };
}

/**
 * Montant remboursé lorsqu'un client signale un problème.
 *
 * Règle du cahier client : **100 % du prix produit**, jamais partiel. Les frais
 * de livraison et la commission Ojà restent acquis.
 */
export function refundAmountFor(lines: Pick<PricedLine, 'lineMakerTotalXof'>[]): Xof {
  return sum(lines, (l) => l.lineMakerTotalXof);
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
