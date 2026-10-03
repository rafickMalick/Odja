import { createHmac, randomInt } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

/**
 * Outils partagés des tests navigateur.
 *
 * Les comptes sont **uniques à chaque exécution** : les tests ne nettoient
 * pas la base derrière eux, et un second passage ne doit pas buter sur une
 * adresse déjà prise.
 */

export const PASSWORD = 'un-mot-de-passe-solide';

export interface TestAccount {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export function newAccount(label: string): TestAccount {
  const stamp = `${Date.now()}${randomInt(1000)}`;
  return {
    firstName: 'Awa',
    lastName: 'Koné',
    email: `${label}.${stamp}@exemple.com`,
    // +229 01 suivi de huit chiffres : un numéro béninois valide, et unique.
    phone: `+22901${String(randomInt(10 ** 8)).padStart(8, '0')}`,
  };
}

/** Inscription par le formulaire, comme un visiteur. */
export async function register(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/inscription');
  await page.getByLabel('Prénom').fill(account.firstName);
  await page.getByLabel('Nom', { exact: true }).fill(account.lastName);
  await page.getByLabel('Adresse e-mail').fill(account.email);
  await page.getByLabel('Téléphone').fill(account.phone);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page).not.toHaveURL(/\/inscription/);
}

/** Connexion par le formulaire, jusqu'au mot de passe inclus. */
export async function submitLogin(page: Page, email: string): Promise<void> {
  await page.goto('/connexion');
  await page.getByLabel('E-mail ou téléphone').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

/**
 * Code TOTP (RFC 6238), comme l'afficherait l'application du téléphone.
 * `offsetSteps` donne le code d'un pas de 30 s plus tard : l'API refuse un
 * code déjà consommé, et tolère un pas d'avance.
 */
export function totp(secretBase32: string, offsetSteps = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secretBase32.replace(/\s/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}
