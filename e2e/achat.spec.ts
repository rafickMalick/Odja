import { expect, test } from '@playwright/test';

import { newAccount, register } from './helpers';

/**
 * Le parcours d'un client, de l'accueil à la confirmation de commande.
 *
 * C'est le chemin qui fait vivre la place de marché : s'il casse, plus rien
 * ne se vend. Il traverse l'affichage par rôle (#21) et la clé d'idempotence
 * envoyée à la commande (#22).
 */

test('un visiteur voit les appels à s’inscrire, un client connecté ne les voit plus', async ({
  page,
}) => {
  await page.goto('/a-propos');
  const header = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(header.getByRole('link', { name: 'Vendre sur Ojà' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Devenir créateur' })).toBeVisible();

  await register(page, newAccount('client.roles'));

  await page.goto('/a-propos');
  await expect(page.getByRole('link', { name: 'Mon compte' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Vendre sur Ojà' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Devenir créateur' })).toHaveCount(0);

  // Un compte connecté n'a rien à faire sur la page d'inscription.
  await page.goto('/inscription');
  await expect(page).toHaveURL(/\/compte/);
});

test('un client trouve une pièce, la commande et reçoit sa confirmation', async ({ page }) => {
  await register(page, newAccount('client.achat'));

  // Le catalogue montre les pièces publiées de l'atelier de démonstration.
  await page.goto('/catalogue');
  await page.getByRole('link', { name: /Lampe globe Sahel/ }).first().click();
  await expect(page).toHaveURL(/\/produit\/lampe-globe-sahel/);
  await page.getByRole('button', { name: 'Ajouter au panier' }).click();

  await page.goto('/panier');
  await expect(page.getByText('Lampe globe Sahel').first()).toBeVisible();
  await page.getByRole('link', { name: 'Passer commande' }).click();
  await expect(page.getByRole('heading', { name: 'Livraison et paiement' })).toBeVisible();

  // Une adresse à Cotonou, la ville de l'atelier : la livraison se chiffre.
  await page.getByLabel('Nom et prénoms *').fill('Awa Koné');
  await page.getByLabel('Téléphone *').fill('+2290197000000');
  await page.getByLabel('Ville *').selectOption({ label: 'Cotonou' });
  await page.getByLabel('Adresse *').fill('Rue 12.034, Haie Vive');
  await page.getByRole('button', { name: 'Enregistrer cette adresse' }).click();
  await expect(page.getByText('Awa Koné · Cotonou')).toBeVisible();

  // Quand payer : en ligne par défaut ; à la livraison, le bouton ne parle
  // plus de payer.
  const payNow = page.getByRole('radio', { name: /Payer maintenant/ });
  await expect(payNow).toBeChecked();
  await page.getByRole('radio', { name: /Payer à la livraison/ }).check();
  await expect(page.getByRole('button', { name: 'Confirmer la commande' })).toBeVisible();
  await payNow.check();

  const confirm = page.getByRole('button', { name: 'Confirmer et payer' });
  await expect(confirm).toBeEnabled();

  // La commande part avec une clé d'idempotence : un double clic n'en crée
  // pas deux.
  const placed = page.waitForRequest(
    (request) => request.url().endsWith('/api/v1/checkout') && request.method() === 'POST',
  );
  await confirm.click();
  const request = await placed;
  expect(request.headers()['idempotency-key']).toMatch(/^[A-Za-z0-9_.:-]{8,128}$/);
  expect(request.postDataJSON()).toMatchObject({ paymentMode: 'ONLINE_FULL' });

  await expect(page).toHaveURL(/\/confirmation\?commande=CMD-/);
  await expect(
    page.getByRole('heading', { name: 'Merci, votre commande est enregistrée' }),
  ).toBeVisible();
});
