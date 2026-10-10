/**
 * Cycle de vie d'une fiche produit.
 *
 * Le cahier client donne au créateur quatre gestes — ajouter, modifier,
 * supprimer, archiver — et à l'administration un droit de regard : consulter,
 * masquer, signaler. Ces deux volontés se rencontrent ici.
 */

export type ProductStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'ARCHIVED';

export const PRODUCT_LABELS: Readonly<Record<ProductStatus, string>> = {
  DRAFT: 'Brouillon',
  PENDING_REVIEW: 'En attente de validation',
  PUBLISHED: 'En ligne',
  REJECTED: 'Refusé',
  ARCHIVED: 'Archivé',
};

const PRODUCT_GRAPH: Readonly<Record<ProductStatus, readonly ProductStatus[]>> = {
  DRAFT: ['PENDING_REVIEW', 'ARCHIVED'],
  // La modération tranche : en ligne, ou refusée avec un motif.
  PENDING_REVIEW: ['PUBLISHED', 'REJECTED', 'DRAFT'],
  // Une fiche en ligne que le créateur modifie repasse en validation : sans
  // cela, on publierait un fauteuil et on le remplacerait par autre chose.
  PUBLISHED: ['PENDING_REVIEW', 'ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  // L'archivage n'est pas définitif : une pièce revient en catalogue quand
  // l'atelier la refait.
  ARCHIVED: ['DRAFT'],
};

export class ProductTransitionError extends Error {
  constructor(
    readonly from: ProductStatus,
    readonly to: ProductStatus,
    readonly allowed: readonly ProductStatus[],
  ) {
    super(
      `transition interdite sur le produit : ${from} → ${to}. ` +
        (allowed.length > 0
          ? `Depuis ${from}, seuls ${allowed.join(', ')} sont possibles.`
          : `${from} est un état terminal.`),
    );
  }
}

export function assertProductTransition(from: ProductStatus, to: ProductStatus): void {
  if (!PRODUCT_GRAPH[from].includes(to)) {
    throw new ProductTransitionError(from, to, PRODUCT_GRAPH[from]);
  }
}

export function productCanTransition(from: ProductStatus, to: ProductStatus): boolean {
  return PRODUCT_GRAPH[from].includes(to);
}

/** Une fiche n'est visible du public que publiée et non masquée. */
export function isProductVisible(product: {
  status: ProductStatus;
  hiddenAt: Date | null;
  deletedAt: Date | null;
}): boolean {
  return product.status === 'PUBLISHED' && !product.hiddenAt && !product.deletedAt;
}

// ═══════════════════════════════════════════ Règles de mise en vente

export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 5;

export interface ProductReadiness {
  /** Faux pour une réalisation de portfolio : ni prix, ni stock à vérifier. */
  isForSale?: boolean;
  imageCount: number;
  makerKycApproved: boolean;
  isMadeToOrder: boolean;
  leadTimeDays: number | null;
  quantityAvailable: number;
  makerPriceXof: number;
}

/**
 * Ce qui manque à une fiche pour partir en validation.
 *
 * Renvoie la liste complète des manques, jamais le premier rencontré : un
 * créateur qui corrige un point à la fois et se voit refuser cinq fois de
 * suite abandonne. Il doit tout voir d'un coup.
 */
export function whyNotSubmittable(product: ProductReadiness): string[] {
  const problems: string[] = [];

  if (!product.makerKycApproved) {
    problems.push(
      'Votre compte doit être validé par Ojà avant toute publication.',
    );
  }

  const forSale = product.isForSale ?? true;

  /* Une réalisation de portfolio se montre, elle ne se vend pas : une photo
     suffit, l'acheteur n'a pas besoin de l'examiner sous tous les angles. */
  const minPhotos = forSale ? MIN_PHOTOS : 1;
  if (product.imageCount < minPhotos) {
    problems.push(
      minPhotos === 1
        ? 'Ajoutez au moins une photo.'
        : `Ajoutez au moins ${minPhotos} photos (${product.imageCount} pour l’instant).`,
    );
  }

  if (product.imageCount > MAX_PHOTOS) {
    problems.push(`Cinq photos au maximum (${product.imageCount} pour l’instant).`);
  }

  if (!forSale) return problems;

  if (product.makerPriceXof <= 0) {
    problems.push('Indiquez le prix auquel vous vendez cette pièce.');
  }

  if (product.isMadeToOrder) {
    if (!product.leadTimeDays || product.leadTimeDays <= 0) {
      problems.push('Indiquez le délai de fabrication en jours.');
    }
  } else if (product.quantityAvailable <= 0) {
    problems.push(
      'Indiquez la quantité disponible, ou passez la pièce en fabrication sur commande.',
    );
  }

  return problems;
}
