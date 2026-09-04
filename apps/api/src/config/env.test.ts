import { describe, expect, it } from 'vitest';

import { validateEnv } from './env';

/**
 * Le refus de démarrer est une fonction de sécurité, pas un confort. Ces tests
 * la traitent comme telle : chaque cas décrit une configuration qui, si elle
 * passait, causerait un dommage réel en exploitation.
 */

const base = {
  DATABASE_URL: 'postgresql://oja:oja@localhost:55432/oja',
  JWT_ACCESS_SECRET: 'un-secret-suffisamment-long',
  JWT_REFRESH_SECRET: 'un-autre-secret-assez-long',
  ARGON2_PEPPER: 'poivre-local',
};

describe('validateEnv', () => {
  it('accepte une configuration de développement minimale', () => {
    const env = validateEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PAYMENT_PROVIDER).toBe('simulated');
  });

  it('applique les valeurs métier du cahier client par défaut', () => {
    const env = validateEnv({ ...base });
    expect(env.PLATFORM_COMMISSION_BPS).toBe(500); // 5 %, ajoutée au prix créateur
    expect(env.PAYOUT_HOLD_HOURS).toBe(24); //        versement 24 h après validation
    expect(env.AUTO_VALIDATE_HOURS).toBe(72);
    expect(env.SUBORDER_ACCEPT_HOURS).toBe(48);
  });

  it('refuse une DATABASE_URL absente', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = base;
    expect(() => validateEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('refuse un secret JWT trop court pour être sérieux', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'court' })).toThrow(
      /16 caractères/,
    );
  });

  it('refuse un facteur de sinuosité inférieur à 1, qui sous-facturerait', () => {
    expect(() => validateEnv({ ...base, DISTANCE_SINUOSITY_FACTOR: '0.8' })).toThrow(
      /Configuration invalide/,
    );
  });

  describe('garde-fou des clés de paiement (cahier § 7.7)', () => {
    it("n'exige aucune clé tant que le fournisseur est simulé", () => {
      expect(() => validateEnv({ ...base, PAYMENT_PROVIDER: 'simulated' })).not.toThrow();
    });

    it('exige une clé secrète dès que Kadev Pay est activé', () => {
      expect(() => validateEnv({ ...base, PAYMENT_PROVIDER: 'kadevpay' })).toThrow(
        /exige une clé secrète/,
      );
    });

    it('refuse une clé de TEST en production', () => {
      // Sinon la boutique semblerait encaisser sans jamais rien encaisser.
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'production',
          PAYMENT_PROVIDER: 'kadevpay',
          KADEVPAY_SECRET_KEY: 'kdvs_test_abc',
          KADEVPAY_MODE: 'live',
        }),
      ).toThrow(/clé de test chargée en production/);
    });

    it('refuse une clé de PRODUCTION hors production', () => {
      // Le sens le plus dangereux : de vrais clients débités depuis un poste
      // de développement.
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'development',
          PAYMENT_PROVIDER: 'kadevpay',
          KADEVPAY_SECRET_KEY: 'kdvs_live_abc',
        }),
      ).toThrow(/clé de production chargée hors production/);
    });

    it('refuse le mode test en production', () => {
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'production',
          PAYMENT_PROVIDER: 'kadevpay',
          KADEVPAY_SECRET_KEY: 'kdvs_live_abc',
          KADEVPAY_MODE: 'test',
        }),
      ).toThrow(/KADEVPAY_MODE/);
    });

    it('exige une clé publique dès que Kadev Pay est activé', () => {
      expect(() =>
        validateEnv({
          ...base,
          PAYMENT_PROVIDER: 'kadevpay',
          KADEVPAY_SECRET_KEY: 'kdvs_test_abc',
        }),
      ).toThrow(/exige une clé publique/);
    });

    it('exige le secret webhook dès que Kadev Pay est activé', () => {
      /* Sans ce garde-fou, une valeur vide passe la validation Zod (`optional()`
         n'exige que l'absence, pas la non-vacuité) et la vérification de
         signature calculerait un HMAC avec une clé vide — franchissable par
         quiconque connaît ce défaut. */
      expect(() =>
        validateEnv({
          ...base,
          PAYMENT_PROVIDER: 'kadevpay',
          KADEVPAY_SECRET_KEY: 'kdvs_test_abc',
          KADEVPAY_PUBLIC_KEY: 'kdvp_test_abc',
          KADEVPAY_WEBHOOK_SECRET: '',
        }),
      ).toThrow(/exige le secret webhook/);
    });

    it('accepte la seule combinaison correcte en production', () => {
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'production',
          PAYMENT_PROVIDER: 'kadevpay',
          KADEVPAY_SECRET_KEY: 'kdvs_live_abc',
          KADEVPAY_PUBLIC_KEY: 'kdvp_live_abc',
          KADEVPAY_WEBHOOK_SECRET: 'whsec_live_abc',
          KADEVPAY_MODE: 'live',
        }),
      ).not.toThrow();
    });
  });

  it('rassemble toutes les erreurs plutôt que de s’arrêter à la première', () => {
    try {
      validateEnv({ ...base, JWT_ACCESS_SECRET: 'x', ARGON2_PEPPER: 'y' });
      expect.unreachable('la configuration aurait dû être refusée');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('ARGON2_PEPPER');
    }
  });
});

describe('lecture des booléens', () => {
  const base = {
    DATABASE_URL: 'postgresql://oja:oja@localhost:55432/oja',
    JWT_ACCESS_SECRET: 'un-secret-suffisamment-long',
    JWT_REFRESH_SECRET: 'un-autre-secret-assez-long',
    ARGON2_PEPPER: 'poivre-local',
  };

  it('lit "false" comme faux', () => {
    /* `z.coerce.boolean()` appliquerait `Boolean("false")`, qui vaut true.
       Le bug a réellement eu lieu : la vérification par SMS s'était
       réactivée en silence et bloquait toutes les connexions. */
    expect(validateEnv({ ...base, REQUIRE_PHONE_VERIFICATION: 'false' })
      .REQUIRE_PHONE_VERIFICATION).toBe(false);
    expect(validateEnv({ ...base, REQUIRE_PHONE_VERIFICATION: '0' })
      .REQUIRE_PHONE_VERIFICATION).toBe(false);
  });

  it('lit "true" comme vrai', () => {
    for (const value of ['true', '1', 'yes', 'oui', 'on', 'TRUE']) {
      expect(validateEnv({ ...base, REQUIRE_PHONE_VERIFICATION: value })
        .REQUIRE_PHONE_VERIFICATION).toBe(true);
    }
  });

  it('retient le défaut en l’absence de valeur', () => {
    // La vérification par SMS est mise de côté : elle est fausse par défaut.
    expect(validateEnv({ ...base }).REQUIRE_PHONE_VERIFICATION).toBe(false);
  });
});
