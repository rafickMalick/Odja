import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  stepAt,
  totpForStep,
  verifyTotp,
} from './totp';

/**
 * TOTP contre les vecteurs officiels de la RFC 6238 (annexe B, SHA-1), puis
 * les garde-fous propres à Ojà : rejeu, dérive d'horloge, chiffrement.
 */

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP — vecteurs de la RFC 6238', () => {
  // Les vecteurs ont 8 chiffres ; on en garde les 6 derniers.
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
  ])('à %i s, le code est %s', (seconds, code) => {
    expect(totpForStep(RFC_SECRET, stepAt(seconds * 1000))).toBe(code);
  });
});

describe('Vérification', () => {
  const now = 1_234_567_890_000;
  const current = stepAt(now);

  it('accepte le code courant et renvoie son pas', () => {
    expect(verifyTotp(RFC_SECRET, '005924', null, now)).toBe(current);
  });

  it('tolère un pas de dérive, pas deux', () => {
    const previous = totpForStep(RFC_SECRET, current - 1);
    const tooOld = totpForStep(RFC_SECRET, current - 2);
    expect(verifyTotp(RFC_SECRET, previous, null, now)).toBe(current - 1);
    expect(verifyTotp(RFC_SECRET, tooOld, null, now)).toBeNull();
  });

  it('refuse un code déjà utilisé', () => {
    expect(verifyTotp(RFC_SECRET, '005924', current, now)).toBeNull();
  });

  it('refuse ce qui n’est pas six chiffres', () => {
    expect(verifyTotp(RFC_SECRET, '12345', null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', null, now)).toBeNull();
  });
});

describe('Secret', () => {
  it('fait 160 bits et survit à un aller-retour base32', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it('est chiffré en base, et seul le bon poivre le relit', () => {
    const stored = encryptSecret(RFC_SECRET, 'poivre-de-test');
    expect(stored).not.toContain(RFC_SECRET);
    expect(decryptSecret(stored, 'poivre-de-test')).toBe(RFC_SECRET);
    expect(() => decryptSecret(stored, 'autre-poivre')).toThrow();
  });

  it('produit un lien que les applications d’authentification comprennent', () => {
    const url = otpauthUrl(RFC_SECRET, 'admin@oja.market');
    expect(url).toMatch(/^otpauth:\/\/totp\/Oj%C3%A0%3Aadmin%40oja\.market\?/);
    expect(url).toContain(`secret=${RFC_SECRET}`);
    expect(url).toContain('issuer=Oj%C3%A0');
  });
});

describe('Codes de secours', () => {
  it('se lisent au téléphone : trois groupes de quatre, sans 0, O, 1 ni I', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it('se comparent sans tenir compte de la casse ni des tirets', () => {
    expect(hashRecoveryCode('abcd-efgh-jklm')).toBe(hashRecoveryCode('ABCDEFGHJKLM'));
  });
});
