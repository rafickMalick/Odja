import { describe, expect, it } from 'vitest';

import { haversineKm } from './delivery';
import {
  assessProof,
  formatDeliveryOtp,
  GPS_TOLERANCE_METERS,
  REQUIRED_PROOF_ELEMENTS,
  type ProofContext,
} from './proof-of-delivery';

const DESTINATION = { latitude: 5.3599, longitude: -3.9855 };

const context = (): ProofContext => ({
  expectedOtp: '4271',
  destination: DESTINATION,
  distanceMeters: (point) => haversineKm(DESTINATION, point) * 1000,
});

/** Décale un point de quelques mètres vers le nord. */
const nearby = (meters: number) => ({
  latitude: DESTINATION.latitude + meters / 111_320,
  longitude: DESTINATION.longitude,
});

describe('preuve de livraison', () => {
  it('accepte deux éléments sur trois', () => {
    // Exiger les trois bloquerait des livraisons honnêtes : réseau absent,
    // batterie vide, GPS qui dérive entre deux immeubles.
    const result = assessProof(
      { otp: '4271', photoKey: 'proof/photo.jpg' },
      context(),
    );

    expect(result.accepted).toBe(true);
    expect(result.provided).toEqual(['otp', 'photo']);
    expect(result.problems).toEqual([]);
  });

  it('accepte code + position, sans photo', () => {
    const result = assessProof({ otp: '4271', ...nearby(50) }, context());
    expect(result.accepted).toBe(true);
    expect(result.provided).toEqual(['otp', 'gps']);
  });

  it('accepte photo + position, sans code', () => {
    // Le client n'a pas reçu son SMS : la livraison reste prouvable.
    const result = assessProof(
      { photoKey: 'proof/photo.jpg', ...nearby(20) },
      context(),
    );
    expect(result.accepted).toBe(true);
    expect(result.provided).toEqual(['photo', 'gps']);
  });

  it('refuse un seul élément', () => {
    // N'en exiger qu'un rendrait la preuve trop facile à fabriquer.
    const result = assessProof({ photoKey: 'proof/photo.jpg' }, context());
    expect(result.accepted).toBe(false);
    expect(result.provided).toEqual(['photo']);
  });

  it('refuse une preuve vide', () => {
    const result = assessProof({}, context());
    expect(result.accepted).toBe(false);
    expect(result.provided).toEqual([]);
    expect(result.problems.length).toBe(3);
  });

  it('rejette un code erroné sans le compter', () => {
    const result = assessProof(
      { otp: '0000', photoKey: 'proof/photo.jpg' },
      context(),
    );
    expect(result.provided).toEqual(['photo']);
    expect(result.accepted).toBe(false);
    expect(result.problems.join(' ')).toContain('ne correspond pas');
  });

  it('rejette une position trop éloignée de l’adresse', () => {
    const far = {
      latitude: DESTINATION.latitude + 0.05, // ~5,5 km
      longitude: DESTINATION.longitude,
    };
    const result = assessProof({ photoKey: 'proof/photo.jpg', ...far }, context());

    expect(result.provided).toEqual(['photo']);
    expect(result.accepted).toBe(false);
    expect(result.problems.join(' ')).toContain(`${GPS_TOLERANCE_METERS} m`);
  });

  it('accepte une position juste dans la tolérance', () => {
    const result = assessProof(
      { otp: '4271', ...nearby(GPS_TOLERANCE_METERS - 20) },
      context(),
    );
    expect(result.provided).toContain('gps');
  });

  it('ne compte pas la position quand l’adresse n’a aucun point GPS', () => {
    // Sinon n'importe quelle position vaudrait preuve.
    const result = assessProof(
      { photoKey: 'proof/photo.jpg', ...nearby(10) },
      { expectedOtp: '4271' },
    );
    expect(result.provided).toEqual(['photo']);
    expect(result.accepted).toBe(false);
    expect(result.problems.join(' ')).toContain('point GPS à comparer');
  });

  it('accepte le code du client à lui seul', () => {
    // Le livreur tape le code sur son téléphone : c'est confirmé.
    const result = assessProof({ otp: '4271' }, context());
    expect(result.accepted).toBe(true);
    expect(result.provided).toEqual(['otp']);
    expect(result.problems).toEqual([]);
  });

  it('dit au livreur ce qui manque, pas seulement que ça manque', () => {
    // Un livreur qui lit « preuve insuffisante » reste planté devant la porte.
    const result = assessProof({}, context());
    expect(result.accepted).toBe(false);
    expect(result.problems.join(' ')).toContain('code');
    expect(result.problems.join(' ')).toContain('photo');
    expect(result.problems.join(' ')).toContain('localisation');
  });

  it('n’expose plus de manque une fois la preuve acceptée', () => {
    const result = assessProof({ otp: '4271', photoKey: 'p.jpg' }, context());
    expect(result.problems).toEqual([]);
  });

  describe('localisation en pause', () => {
    const paused = (): ProofContext => ({ ...context(), gpsEnabled: false });

    it('accepte toujours le code seul', () => {
      expect(assessProof({ otp: '4271' }, paused()).accepted).toBe(true);
    });

    it('accepte la photo seule, faute de position', () => {
      const result = assessProof({ photoKey: 'proof/photo.jpg' }, paused());
      expect(result.accepted).toBe(true);
      expect(result.provided).toEqual(['photo']);
    });

    it('ignore la position envoyée et ne la réclame pas', () => {
      const result = assessProof({ ...nearby(10) }, paused());
      expect(result.accepted).toBe(false);
      expect(result.provided).toEqual([]);
      expect(result.problems.join(' ')).not.toContain('localisation');
    });

    it('refuse toujours un code erroné', () => {
      const result = assessProof({ otp: '0000' }, paused());
      expect(result.accepted).toBe(false);
    });
  });

  it('exige bien deux éléments sans le code', () => {
    expect(REQUIRED_PROOF_ELEMENTS).toBe(2);
  });
});

describe('code de réception', () => {
  it('fait quatre chiffres, zéros compris', () => {
    // Le client le lit à voix haute sur le pas de sa porte.
    expect(formatDeliveryOtp(42)).toBe('0042');
    expect(formatDeliveryOtp(4271)).toBe('4271');
    expect(formatDeliveryOtp(0)).toBe('0000');
  });

  it('reste à quatre chiffres au-delà de la borne', () => {
    expect(formatDeliveryOtp(123_456)).toBe('3456');
    expect(formatDeliveryOtp(-7)).toBe('0007');
  });
});
