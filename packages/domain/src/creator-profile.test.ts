import { describe, expect, it } from 'vitest';

import {
  activeSubscription,
  displayAvailability,
  findContactDetails,
  isPurchasable,
  missingForReview,
  publicationQuotaProblem,
} from './creator-profile';

describe('coordonnées dans un texte public', () => {
  it.each([
    'Appelez-moi au 97 12 34 56',
    'Contact : +229 01 97 12 34 56',
    'Joignable au 0197123456',
    'tel. 97.12.34.56',
  ])('repère le numéro dans « %s »', (text) => {
    expect(findContactDetails(text)).toMatch(/numéro/);
  });

  it('repère une adresse e-mail', () => {
    expect(findContactDetails('Écrivez à atelier@exemple.bj')).toMatch(/e-mail/);
  });

  it('repère un lien de messagerie', () => {
    expect(findContactDetails('Commandes sur wa.me/22997123456')).not.toBeNull();
  });

  it.each([
    'Atelier fondé en 1998, 25 ans de métier.',
    'Table de 180 x 90 x 75 cm en iroko.',
    'Pièces livrées sous 10 à 15 jours.',
    'Collection 2024-2025',
  ])('laisse passer « %s »', (text) => {
    expect(findContactDetails(text)).toBeNull();
  });
});

describe('disponibilité affichée', () => {
  const base = {
    isForSale: true,
    availability: 'AVAILABLE' as const,
    isMadeToOrder: false,
    quantityAvailable: 2,
    quantityReserved: 0,
  };

  it('une réalisation de portfolio n’est jamais achetable', () => {
    const portfolio = { ...base, isForSale: false };
    expect(displayAvailability(portfolio)).toBe('PORTFOLIO');
    expect(isPurchasable(portfolio)).toBe(false);
  });

  it('« vendu » l’emporte sur le stock restant', () => {
    expect(displayAvailability({ ...base, availability: 'SOLD' })).toBe('SOLD');
  });

  it('une pièce sur commande reste achetable sans stock', () => {
    const toOrder = { ...base, isMadeToOrder: true, quantityAvailable: 0 };
    expect(displayAvailability(toOrder)).toBe('MADE_TO_ORDER');
    expect(isPurchasable(toOrder)).toBe(true);
  });

  it('un stock entièrement réservé rend la pièce indisponible', () => {
    expect(displayAvailability({ ...base, quantityReserved: 2 })).toBe('UNAVAILABLE');
  });
});

describe('souscription en cours', () => {
  const plan = { id: 'premium', maxPublications: 100 };
  const now = new Date('2026-10-10T12:00:00Z');
  const at = (iso: string) => new Date(iso);

  it('ignore une période échue, résiliée ou à venir', () => {
    expect(
      activeSubscription(
        [
          { plan, startsAt: at('2026-08-01'), endsAt: at('2026-09-01'), cancelledAt: null },
          { plan, startsAt: at('2026-10-01'), endsAt: at('2026-11-01'), cancelledAt: at('2026-10-05') },
          { plan, startsAt: at('2026-11-01'), endsAt: at('2026-12-01'), cancelledAt: null },
        ],
        now,
      ),
    ).toBeNull();
  });

  it('retient la période la plus récemment commencée', () => {
    const renewed = { plan, startsAt: at('2026-10-09'), endsAt: at('2026-11-09'), cancelledAt: null };
    expect(
      activeSubscription(
        [{ plan, startsAt: at('2026-09-20'), endsAt: at('2026-10-20'), cancelledAt: null }, renewed],
        now,
      ),
    ).toBe(renewed);
  });

  it('une période sans échéance reste en cours', () => {
    expect(
      activeSubscription([{ plan, startsAt: at('2026-01-01'), endsAt: null, cancelledAt: null }], now),
    ).not.toBeNull();
  });
});

describe('quota de publications', () => {
  it('laisse créer sous le plafond, et toujours sans plafond', () => {
    expect(publicationQuotaProblem(19, 20, 'Standard')).toBeNull();
    expect(publicationQuotaProblem(500, null, 'Premium')).toBeNull();
  });

  it('refuse au plafond, en nommant la formule', () => {
    expect(publicationQuotaProblem(20, 20, 'Standard')).toMatch(/Standard permet 20/);
  });
});

describe('dossier prêt à déposer', () => {
  const base = {
    managerName: 'Rachida',
    contactPhone: '+22997000000',
    postalAddress: 'Haie Vive',
    pickupLine1: 'Rue 12',
    ifuNumber: null,
    rccmNumber: null,
    trainingInstitution: null,
    trainingSpecialty: null,
  };

  it('demande un IFU ou un RCCM à un professionnel', () => {
    expect(missingForReview({ ...base, creatorKind: 'ARTISAN' }, [])).toEqual(['numéro IFU ou RCCM']);
  });

  it('demande à un apprenti sa formation et son justificatif, pas un IFU', () => {
    const missing = missingForReview({ ...base, creatorKind: 'APPRENTICE_DESIGNER' }, []);
    expect(missing).toContain('justificatif de formation');
    expect(missing).toContain('établissement ou atelier de formation');
    expect(missing).not.toContain('numéro IFU ou RCCM');
  });

  it('accepte le dossier complet d’un apprenti', () => {
    expect(
      missingForReview(
        {
          ...base,
          creatorKind: 'APPRENTICE_ARTISAN',
          trainingInstitution: 'Centre Songhaï',
          trainingSpecialty: 'Vannerie',
        },
        ['justificatif_formation'],
      ),
    ).toEqual([]);
  });
});
