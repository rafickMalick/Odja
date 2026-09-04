import { describe, expect, it } from 'vitest';

import {
  assertOrderTransition,
  assertShipmentTransition,
  assertSubOrderTransition,
  autoValidateAt,
  ORDER_LABELS,
  orderCanTransition,
  payoutReleaseAt,
  productionDueAt,
  SHIPMENT_LABELS,
  SUB_ORDER_LABELS,
  subOrderRespondByAt,
  TransitionError,
  type OrderStatus,
} from './states';

describe('libellés', () => {
  it('reprend les mots du cahier client pour le créateur', () => {
    expect(SUB_ORDER_LABELS.RECEIVED).toBe('Commande reçue');
    expect(SUB_ORDER_LABELS.PAYMENT_CONFIRMED).toBe('Paiement confirmé');
    expect(SUB_ORDER_LABELS.IN_PRODUCTION).toBe('En fabrication');
    expect(SUB_ORDER_LABELS.READY_FOR_PICKUP).toBe('Prêt à récupérer');
    expect(SUB_ORDER_LABELS.IN_DELIVERY).toBe('En cours de livraison');
  });

  it('reprend les mots du cahier client pour le client', () => {
    expect(ORDER_LABELS.CONFIRMED).toBe('Commande confirmée');
    expect(ORDER_LABELS.IN_PRODUCTION).toBe('En fabrication');
    expect(ORDER_LABELS.PREPARING).toBe('En préparation');
    expect(ORDER_LABELS.IN_DELIVERY).toBe('En livraison');
    expect(ORDER_LABELS.DELIVERED).toBe('Livrée');
  });

  it('reprend les mots du cahier client pour le livreur', () => {
    expect(SHIPMENT_LABELS.TO_PICK_UP).toBe('À récupérer');
    expect(SHIPMENT_LABELS.PICKED_UP).toBe('Récupéré');
    expect(SHIPMENT_LABELS.IN_DELIVERY).toBe('En livraison');
    expect(SHIPMENT_LABELS.RETURN_REQUIRED).toBe('Produit à retourner');
  });
});

describe('commande', () => {
  it('suit le parcours nominal jusqu’au bout', () => {
    const path: OrderStatus[] = [
      'PENDING_PAYMENT',
      'CONFIRMED',
      'IN_PRODUCTION',
      'PREPARING',
      'IN_DELIVERY',
      'DELIVERED',
      'VALIDATED',
      'COMPLETED',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => assertOrderTransition(path[i]!, path[i + 1]!)).not.toThrow();
    }
  });

  it('n’offre que deux issues après la livraison — c’est là que tout se joue', () => {
    expect(orderCanTransition('DELIVERED', 'VALIDATED')).toBe(true);
    expect(orderCanTransition('DELIVERED', 'DISPUTED')).toBe(true);
    expect(orderCanTransition('DELIVERED', 'COMPLETED')).toBe(false);
    expect(orderCanTransition('DELIVERED', 'REFUNDED')).toBe(false);
  });

  it('interdit de sauter la livraison pour clore une commande', () => {
    expect(() => assertOrderTransition('CONFIRMED', 'COMPLETED')).toThrow(TransitionError);
  });

  it('interdit de revenir en arrière', () => {
    expect(() => assertOrderTransition('IN_DELIVERY', 'PREPARING')).toThrow(TransitionError);
  });

  it('interdit d’annuler une commande déjà livrée', () => {
    expect(() => assertOrderTransition('DELIVERED', 'CANCELLED')).toThrow(TransitionError);
  });

  it('traite les états terminaux comme tels', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED', 'REFUNDED'] as OrderStatus[]) {
      expect(() => assertOrderTransition(terminal, 'CONFIRMED')).toThrow(/état terminal/);
    }
  });

  it('explique ce qui était possible quand elle refuse', () => {
    try {
      assertOrderTransition('CONFIRMED', 'DELIVERED');
      expect.unreachable('la transition aurait dû être refusée');
    } catch (error) {
      expect(error).toBeInstanceOf(TransitionError);
      expect((error as TransitionError).message).toContain('IN_PRODUCTION');
      expect((error as TransitionError).message).toContain('PREPARING');
    }
  });
});

describe('sous-commande', () => {
  it('laisse un produit en stock sauter la fabrication', () => {
    expect(() =>
      assertSubOrderTransition('PAYMENT_CONFIRMED', 'READY_FOR_PICKUP'),
    ).not.toThrow();
  });

  it('fait passer un produit sur commande par la fabrication', () => {
    expect(() =>
      assertSubOrderTransition('PAYMENT_CONFIRMED', 'IN_PRODUCTION'),
    ).not.toThrow();
    expect(() =>
      assertSubOrderTransition('IN_PRODUCTION', 'READY_FOR_PICKUP'),
    ).not.toThrow();
  });

  it('permet le refus tant que la fabrication n’a pas commencé', () => {
    expect(() => assertSubOrderTransition('RECEIVED', 'REJECTED')).not.toThrow();
    expect(() => assertSubOrderTransition('IN_PRODUCTION', 'REJECTED')).toThrow();
  });

  it('interdit d’expédier une pièce qui n’est pas prête', () => {
    expect(() => assertSubOrderTransition('IN_PRODUCTION', 'IN_DELIVERY')).toThrow();
  });
});

describe('expédition', () => {
  it('suit le parcours du livreur', () => {
    expect(() => assertShipmentTransition('TO_PICK_UP', 'PICKED_UP')).not.toThrow();
    expect(() => assertShipmentTransition('PICKED_UP', 'IN_DELIVERY')).not.toThrow();
    expect(() => assertShipmentTransition('IN_DELIVERY', 'DELIVERED')).not.toThrow();
  });

  it('n’ouvre le retour qu’après une livraison', () => {
    expect(() => assertShipmentTransition('DELIVERED', 'RETURN_REQUIRED')).not.toThrow();
    expect(() => assertShipmentTransition('IN_DELIVERY', 'RETURN_REQUIRED')).toThrow();
  });

  it('permet de reprendre une course après un échec', () => {
    expect(() => assertShipmentTransition('FAILED', 'TO_PICK_UP')).not.toThrow();
  });

  it('interdit de récupérer une pièce déjà livrée', () => {
    expect(() => assertShipmentTransition('DELIVERED', 'PICKED_UP')).toThrow();
  });
});

describe('échéances', () => {
  it('libère le versement 24 h après la validation du client', () => {
    const validated = new Date('2026-08-12T10:00:00Z');
    expect(payoutReleaseAt(validated).toISOString()).toBe('2026-08-13T10:00:00.000Z');
  });

  it('arme une validation automatique à 72 h par défaut', () => {
    const delivered = new Date('2026-08-12T10:00:00Z');
    expect(autoValidateAt(delivered).toISOString()).toBe('2026-08-15T10:00:00.000Z');
  });

  it('laisse 48 h au créateur pour répondre', () => {
    const received = new Date('2026-08-12T10:00:00Z');
    expect(subOrderRespondByAt(received).toISOString()).toBe('2026-08-14T10:00:00.000Z');
  });

  it('calcule la fin de fabrication sur le délai de la fiche produit', () => {
    const started = new Date('2026-08-12T10:00:00Z');
    expect(productionDueAt(started, 7).toISOString()).toBe('2026-08-19T10:00:00.000Z');
  });
});
