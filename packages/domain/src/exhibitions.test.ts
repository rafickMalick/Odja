import { describe, expect, it } from 'vitest';

import {
  accessRequirement,
  assertExhibitionTransition,
  canSeeContent,
  exhibitionPeriod,
  ExhibitionTransitionError,
  isPubliclyVisible,
  whyExhibitionNotSubmittable,
  whyNotSchedulable,
  type ExhibitionDraft,
} from './exhibitions';

const draft: ExhibitionDraft = {
  title: 'Terres du Sud',
  summary: 'Céramiques contemporaines.',
  startsAt: new Date('2026-11-01'),
  endsAt: new Date('2026-11-20'),
  format: 'ONLINE',
  venueName: null,
  venueAddress: null,
  accessMode: 'FREE',
  ticketPriceXof: 0,
  hasAccessCode: false,
  planId: 'standard',
};
const standard = { name: 'Standard', maxWorks: 20, maxDurationDays: 30 };

describe('circuit d’une exposition', () => {
  it('suit le parcours du cahier jusqu’à la mise en ligne', () => {
    for (const [from, to] of [
      ['DRAFT', 'SUBMITTED'],
      ['SUBMITTED', 'ACCEPTED'],
      ['ACCEPTED', 'SCHEDULED'],
      ['SCHEDULED', 'PUBLISHED'],
      ['PUBLISHED', 'SUSPENDED'],
      ['SUSPENDED', 'PUBLISHED'],
    ] as const) {
      expect(() => assertExhibitionTransition(from, to)).not.toThrow();
    }
  });

  it('interdit de publier sans instruction, et de revenir sur un refus', () => {
    expect(() => assertExhibitionTransition('DRAFT', 'PUBLISHED')).toThrow(ExhibitionTransitionError);
    expect(() => assertExhibitionTransition('REJECTED', 'SUBMITTED')).toThrow(ExhibitionTransitionError);
  });

  it('montre une exposition programmée dès sa date de mise en ligne', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    expect(isPubliclyVisible({ status: 'SCHEDULED', publishAt: new Date('2026-11-01T08:00:00Z') }, now)).toBe(true);
    expect(isPubliclyVisible({ status: 'SCHEDULED', publishAt: new Date('2026-11-02') }, now)).toBe(false);
    expect(isPubliclyVisible({ status: 'ACCEPTED', publishAt: null }, now)).toBe(false);
  });

  it('situe l’exposition dans le temps', () => {
    const dates = { startsAt: new Date('2026-11-01'), endsAt: new Date('2026-11-20') };
    expect(exhibitionPeriod(dates, new Date('2026-10-01'))).toBe('UPCOMING');
    expect(exhibitionPeriod(dates, new Date('2026-11-10'))).toBe('ONGOING');
    expect(exhibitionPeriod(dates, new Date('2026-12-01'))).toBe('ENDED');
  });
});

describe('dossier prêt à soumettre', () => {
  it('accepte un dossier complet', () => {
    expect(whyExhibitionNotSubmittable(draft, 5, standard)).toEqual([]);
  });

  it('exige un lieu pour une exposition sur place', () => {
    expect(whyExhibitionNotSubmittable({ ...draft, format: 'HYBRID' }, 5, standard)).toContain(
      'Une exposition sur place doit indiquer le nom et l’adresse du lieu.',
    );
  });

  it('applique les plafonds de la formule', () => {
    const problems = whyExhibitionNotSubmittable(
      { ...draft, endsAt: new Date('2027-01-15') },
      25,
      standard,
    );
    expect(problems.join(' ')).toMatch(/20 œuvres/);
    expect(problems.join(' ')).toMatch(/30 jours/);
  });

  it('exige un prix pour un accès payant et un code pour un accès réservé', () => {
    expect(whyExhibitionNotSubmittable({ ...draft, accessMode: 'PAID' }, 1, standard).join(' ')).toMatch(/billet/);
    expect(whyExhibitionNotSubmittable({ ...draft, accessMode: 'RESTRICTED' }, 1, standard).join(' ')).toMatch(/code/);
  });
});

describe('programmation', () => {
  it('attend le contrat signé et le paiement d’une formule payante', () => {
    expect(whyNotSchedulable({ contractSignedAt: null, paymentReceivedAt: null, priceXof: 50_000 })).toEqual([
      'le contrat signé',
      'le paiement de la formule',
    ]);
  });

  it('n’attend pas de paiement pour une formule gratuite', () => {
    expect(whyNotSchedulable({ contractSignedAt: new Date(), paymentReceivedAt: null, priceXof: 0 })).toEqual([]);
  });
});

describe('accès aux contenus', () => {
  it('traduit le réglage de l’organisateur en geste attendu du visiteur', () => {
    expect(accessRequirement({ accessMode: 'FREE', requiresRegistration: false })).toBe('OPEN');
    expect(accessRequirement({ accessMode: 'FREE', requiresRegistration: true })).toBe('REGISTER');
    expect(accessRequirement({ accessMode: 'PAID', requiresRegistration: false })).toBe('TICKET');
    expect(accessRequirement({ accessMode: 'RESTRICTED', requiresRegistration: false })).toBe('CODE');
  });

  it('réserve la galerie payante aux détenteurs d’un billet', () => {
    const paid = { accessMode: 'PAID' as const, requiresRegistration: false };
    expect(canSeeContent(paid, { hasConfirmedPass: false, isOrganizerOrAdmin: false })).toBe(false);
    expect(canSeeContent(paid, { hasConfirmedPass: true, isOrganizerOrAdmin: false })).toBe(true);
    expect(canSeeContent(paid, { hasConfirmedPass: false, isOrganizerOrAdmin: true })).toBe(true);
  });
});
