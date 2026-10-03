import { describe, expect, it, vi } from 'vitest';

import { REDACTED, redactText, redactValue } from './redact';
import { RedactingLogger } from './redacting-logger';

/**
 * Aucun secret ne doit atteindre un journal (cahier § 11, L0-30). Chaque cas
 * ici est une fuite réelle possible : un corps de requête journalisé, une
 * erreur de fournisseur recopiée, une pile d'appels.
 */

describe('Masquage par nom de champ', () => {
  it('masque les champs sensibles à toute profondeur, sans toucher l’original', () => {
    const body = {
      email: 'awa@exemple.com',
      password: 'un-mot-de-passe-solide',
      profile: { iban: 'BJ0610100100144100000000', name: 'Awa' },
      tokens: [{ refreshToken: 'abc' }],
      code: 'PROMO-2026',
    };

    const clean = redactValue(body) as typeof body;

    expect(clean.password).toBe(REDACTED);
    expect(clean.profile.iban).toBe(REDACTED);
    expect(clean.profile.name).toBe('Awa');
    expect(clean.tokens[0]!.refreshToken).toBe(REDACTED);
    // Un code promo n'est pas un secret : il reste lisible au journal.
    expect(clean.code).toBe('PROMO-2026');
    expect(body.password).toBe('un-mot-de-passe-solide');
  });

  it('reconnaît les variantes d’écriture et les suffixes', () => {
    const clean = redactValue({
      current_password: 'x',
      'new-password': 'y',
      kadevpayWebhookSecret: 'z',
      cartToken: 't',
      MFASecret: 's',
    }) as Record<string, string>;
    expect(Object.values(clean).every((value) => value === REDACTED)).toBe(true);
  });

  it('survit aux références circulaires', () => {
    const loop: Record<string, unknown> = { name: 'boucle' };
    loop['self'] = loop;
    expect(redactValue(loop)).toEqual({ name: 'boucle', self: '[circulaire]' });
  });
});

describe('Masquage dans le texte libre', () => {
  it.each([
    ['un jeton JWT', 'jeton eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl reçu'],
    ['un en-tête Bearer', 'Authorization: Bearer abc.def-ghi'],
    ['une clé Brevo', 'clé xkeysib-0123456789abcdef-XYZ refusée'],
    ['une clé Kadev Pay', 'KADEVPAY_SECRET_KEY=kdvs_live_abcdef123456'],
    ['un mot de passe en clair', 'login failed password=hunter2 for user'],
  ])('masque %s', (_label, text) => {
    const clean = redactText(text);
    expect(clean).toContain(REDACTED);
    expect(clean).not.toMatch(/eyJzdWIi|abc\.def|xkeysib-0123|kdvs_live_abc|hunter2/);
  });

  it('réduit une adresse e-mail à ses deux premières lettres', () => {
    expect(redactText('envoyé à awa.kone@exemple.com')).toBe('envoyé à aw••••••@exemple.com');
  });

  it('masque aussi le message et la pile d’une erreur', () => {
    const error = new Error('Brevo a refusé la clé xkeysib-secret-123');
    const clean = redactValue(error) as Error;
    expect(clean.message).not.toContain('xkeysib-secret-123');
    expect(clean.stack).not.toContain('xkeysib-secret-123');
  });
});

describe('Journaliseur filtrant', () => {
  it('ne laisse sortir aucun secret, message ou pile', () => {
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });

    const logger = new RedactingLogger('Test');
    logger.log('connexion de awa@exemple.com avec password=hunter2');
    logger.error('Échec Brevo', 'Error: clé xkeysib-abc-123\n    at send (email.ts:1:1)');

    spy.mockRestore();
    errSpy.mockRestore();
    const output = written.join('');
    expect(output).not.toMatch(/hunter2|xkeysib-abc-123|awa@exemple\.com/);
    expect(output).toContain(REDACTED);
  });
});
