import { describe, expect, it } from 'vitest';

import { normalizePhone, phoneSchema, phoneVariants } from './auth';

describe('numéros béninois', () => {
  it('accepte le numéro tel qu’on le tape aujourd’hui (10 chiffres)', () => {
    expect(normalizePhone('01 97 00 00 00')).toBe('+2290197000000');
    expect(normalizePhone('01.97.00.00.00')).toBe('+2290197000000');
  });

  it('passe l’ancien format à 8 chiffres au nouveau', () => {
    expect(normalizePhone('97 00 00 00')).toBe('+2290197000000');
    expect(normalizePhone('+229 97 00 00 00')).toBe('+2290197000000');
  });

  it('garde un numéro déjà complet', () => {
    expect(normalizePhone('+229 01 97 00 00 00')).toBe('+2290197000000');
    expect(normalizePhone('00229 01 97 00 00 00')).toBe('+2290197000000');
  });

  it('laisse passer les autres pays avec leur indicatif', () => {
    expect(normalizePhone('+225 07 08 09 10 11')).toBe('+2250708091011');
  });

  it('valide via le schéma, avec un message béninois en cas d’erreur', () => {
    expect(phoneSchema.parse('01 97 00 00 00')).toBe('+2290197000000');
    const bad = phoneSchema.safeParse('12');
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('+229 01 97 00 00 00');
  });

  it('retrouve un compte créé avec l’ancien format', () => {
    expect(phoneVariants('01 97 00 00 00')).toEqual(['+2290197000000', '+22997000000']);
    expect(phoneVariants('+2250708091011')).toEqual(['+2250708091011']);
  });
});
