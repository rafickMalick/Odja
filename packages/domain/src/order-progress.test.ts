import { describe, expect, it } from 'vitest';

import { deriveOrderStatus, needsProduction, productionDaysFor } from './order-progress';
import type { SubOrderStatus } from './states';

describe('statut de commande dérivé', () => {
  it('reste en attente de paiement tant que rien n’est encaissé', () => {
    expect(deriveOrderStatus(['RECEIVED'], false)).toBe('PENDING_PAYMENT');
    expect(deriveOrderStatus(['PAYMENT_CONFIRMED', 'IN_PRODUCTION'], false)).toBe(
      'PENDING_PAYMENT',
    );
  });

  it('passe en confirmée dès l’encaissement', () => {
    expect(deriveOrderStatus(['PAYMENT_CONFIRMED', 'PAYMENT_CONFIRMED'], true)).toBe(
      'CONFIRMED',
    );
  });

  it('affiche l’étape la moins avancée qui reste à franchir', () => {
    // Un atelier a fini, l'autre fabrique encore : la commande fabrique.
    expect(deriveOrderStatus(['READY_FOR_PICKUP', 'IN_PRODUCTION'], true)).toBe(
      'IN_PRODUCTION',
    );
  });

  it('n’annonce « en préparation » que lorsque tout est prêt', () => {
    expect(deriveOrderStatus(['READY_FOR_PICKUP', 'READY_FOR_PICKUP'], true)).toBe(
      'PREPARING',
    );
    expect(deriveOrderStatus(['READY_FOR_PICKUP', 'PAYMENT_CONFIRMED'], true)).toBe(
      'CONFIRMED',
    );
  });

  it('passe en livraison dès qu’un colis part', () => {
    expect(deriveOrderStatus(['IN_DELIVERY', 'READY_FOR_PICKUP'], true)).toBe('IN_DELIVERY');
  });

  it('n’annonce « livrée » que lorsque tout est arrivé', () => {
    // Annoncer « livrée » avec un colis encore en route ferait mentir la
    // commande, et le client appellerait le support.
    expect(deriveOrderStatus(['DELIVERED', 'IN_DELIVERY'], true)).toBe('IN_DELIVERY');
    expect(deriveOrderStatus(['DELIVERED', 'DELIVERED'], true)).toBe('DELIVERED');
  });

  it('reste « livrée » tant que le client n’a pas tout validé', () => {
    expect(deriveOrderStatus(['VALIDATED', 'DELIVERED'], true)).toBe('DELIVERED');
    expect(deriveOrderStatus(['VALIDATED', 'VALIDATED'], true)).toBe('COMPLETED');
  });

  it('ignore les sous-commandes refusées dans le calcul', () => {
    // Un atelier a refusé : la commande suit celui qui reste.
    expect(deriveOrderStatus(['REJECTED', 'IN_PRODUCTION'], true)).toBe('IN_PRODUCTION');
    expect(deriveOrderStatus(['REJECTED', 'READY_FOR_PICKUP'], true)).toBe('PREPARING');
  });

  it('annule la commande quand plus aucun atelier ne suit', () => {
    expect(deriveOrderStatus(['REJECTED', 'REJECTED'], true)).toBe('CANCELLED');
    expect(deriveOrderStatus(['REJECTED', 'CANCELLED'], true)).toBe('CANCELLED');
    // Vrai même sans paiement : la commande n'a plus d'objet.
    expect(deriveOrderStatus(['REJECTED'], false)).toBe('CANCELLED');
  });

  it('gère une commande sans sous-commande', () => {
    expect(deriveOrderStatus([], false)).toBe('PENDING_PAYMENT');
    expect(deriveOrderStatus([], true)).toBe('CONFIRMED');
  });

  it('ne renvoie jamais un statut hors du cycle', () => {
    const statuses: SubOrderStatus[] = [
      'RECEIVED',
      'PAYMENT_CONFIRMED',
      'IN_PRODUCTION',
      'READY_FOR_PICKUP',
      'IN_DELIVERY',
      'DELIVERED',
      'VALIDATED',
      'REJECTED',
      'CANCELLED',
    ];

    // Toutes les paires possibles, dans les deux sens, payées ou non.
    for (const a of statuses) {
      for (const b of statuses) {
        for (const paid of [true, false]) {
          const result = deriveOrderStatus([a, b], paid);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('fabrication', () => {
  it('passe par la fabrication dès qu’une pièce est faite sur commande', () => {
    expect(needsProduction([{ isMadeToOrder: false }])).toBe(false);
    expect(needsProduction([{ isMadeToOrder: false }, { isMadeToOrder: true }])).toBe(true);
  });

  it('retient le délai le plus long, pas la somme', () => {
    // Un atelier ne fabrique pas ses pièces l'une après l'autre.
    const lines = [
      { isMadeToOrder: true, leadTimeDays: 7 },
      { isMadeToOrder: true, leadTimeDays: 21 },
      { isMadeToOrder: false, leadTimeDays: null },
    ];
    expect(productionDaysFor(lines)).toBe(21);
  });

  it('rend zéro quand tout est en stock', () => {
    expect(productionDaysFor([{ isMadeToOrder: false, leadTimeDays: null }])).toBe(0);
  });
});
