import { describe, expect, it } from 'vitest';

import {
  assertProductTransition,
  isProductVisible,
  PRODUCT_LABELS,
  productCanTransition,
  ProductTransitionError,
  whyNotSubmittable,
  type ProductReadiness,
} from './product-states';

const ready: ProductReadiness = {
  imageCount: 3,
  makerKycApproved: true,
  isMadeToOrder: false,
  leadTimeDays: null,
  quantityAvailable: 2,
  makerPriceXof: 100_000,
};

describe('cycle de vie du produit', () => {
  it('suit le parcours nominal', () => {
    expect(() => assertProductTransition('DRAFT', 'PENDING_REVIEW')).not.toThrow();
    expect(() => assertProductTransition('PENDING_REVIEW', 'PUBLISHED')).not.toThrow();
  });

  it('interdit de publier sans passer par la modération', () => {
    expect(() => assertProductTransition('DRAFT', 'PUBLISHED')).toThrow(
      ProductTransitionError,
    );
  });

  it('renvoie en validation une fiche publiée que le créateur modifie', () => {
    // Sans quoi on publierait un fauteuil pour le remplacer ensuite par autre chose.
    expect(productCanTransition('PUBLISHED', 'PENDING_REVIEW')).toBe(true);
  });

  it('laisse un refus repartir en brouillon', () => {
    expect(() => assertProductTransition('REJECTED', 'DRAFT')).not.toThrow();
    expect(() => assertProductTransition('REJECTED', 'PUBLISHED')).toThrow();
  });

  it('permet de sortir un produit des archives', () => {
    expect(() => assertProductTransition('ARCHIVED', 'DRAFT')).not.toThrow();
  });

  it('explique ce qui était possible quand elle refuse', () => {
    try {
      assertProductTransition('DRAFT', 'PUBLISHED');
      expect.unreachable('la transition aurait dû être refusée');
    } catch (error) {
      expect((error as Error).message).toContain('PENDING_REVIEW');
    }
  });

  it('nomme les états en français', () => {
    expect(PRODUCT_LABELS.PENDING_REVIEW).toBe('En attente de validation');
    expect(PRODUCT_LABELS.PUBLISHED).toBe('En ligne');
  });
});

describe('visibilité publique', () => {
  it('ne montre qu’une fiche publiée, non masquée, non supprimée', () => {
    expect(isProductVisible({ status: 'PUBLISHED', hiddenAt: null, deletedAt: null })).toBe(true);
    expect(isProductVisible({ status: 'DRAFT', hiddenAt: null, deletedAt: null })).toBe(false);
    expect(isProductVisible({ status: 'PUBLISHED', hiddenAt: new Date(), deletedAt: null })).toBe(false);
    expect(isProductVisible({ status: 'PUBLISHED', hiddenAt: null, deletedAt: new Date() })).toBe(false);
  });
});

describe('conditions de mise en vente', () => {
  it('laisse passer une fiche complète', () => {
    expect(whyNotSubmittable(ready)).toEqual([]);
  });

  it('bloque tant que le compte du créateur n’est pas validé', () => {
    const problems = whyNotSubmittable({ ...ready, makerKycApproved: false });
    expect(problems.join(' ')).toContain('validé par Ojà');
  });

  it('exige entre 3 et 5 photos, comme le cahier client', () => {
    expect(whyNotSubmittable({ ...ready, imageCount: 2 }).join(' ')).toContain('au moins 3');
    expect(whyNotSubmittable({ ...ready, imageCount: 6 }).join(' ')).toContain('maximum');
    expect(whyNotSubmittable({ ...ready, imageCount: 5 })).toEqual([]);
  });

  it('exige un délai pour une pièce fabriquée sur commande', () => {
    const problems = whyNotSubmittable({
      ...ready,
      isMadeToOrder: true,
      leadTimeDays: null,
      quantityAvailable: 0,
    });
    expect(problems.join(' ')).toContain('délai de fabrication');
  });

  it('n’exige pas de stock sur une pièce fabriquée sur commande', () => {
    expect(
      whyNotSubmittable({
        ...ready,
        isMadeToOrder: true,
        leadTimeDays: 14,
        quantityAvailable: 0,
      }),
    ).toEqual([]);
  });

  it('exige un stock sur une pièce annoncée disponible', () => {
    const problems = whyNotSubmittable({ ...ready, quantityAvailable: 0 });
    expect(problems.join(' ')).toContain('quantité disponible');
  });

  it('remonte TOUS les manques d’un coup, pas le premier', () => {
    // Un créateur qui corrige un point à la fois et se voit refuser cinq fois
    // de suite abandonne.
    const problems = whyNotSubmittable({
      imageCount: 0,
      makerKycApproved: false,
      isMadeToOrder: false,
      leadTimeDays: null,
      quantityAvailable: 0,
      makerPriceXof: 0,
    });
    expect(problems.length).toBe(4);
  });
});
