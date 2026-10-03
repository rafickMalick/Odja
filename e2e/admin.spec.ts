import { expect, test, type Page } from '@playwright/test';

import { newAccount, register, submitLogin, totp, type TestAccount } from './helpers';

/**
 * L'espace administrateur, ouvert comme le ferait l'équipe Ojà.
 *
 * Un compte devient administrateur par la base (comme le fait
 * ADMIN_BOOTSTRAP_EMAIL) : aucun écran ne permet de se nommer soi-même.
 *
 * Si l'API exige la double authentification (#23, `ADMIN_MFA_REQUIRED`), le
 * test l'active comme le ferait l'admin, en lisant la clé à l'écran ; sinon,
 * il entre directement. Il reste ainsi vrai avant comme après la fusion.
 */

test.skip(!process.env['DATABASE_URL'], 'DATABASE_URL requis pour nommer un administrateur');

async function makeAdmin(email: string): Promise<void> {
  /* Import différé : le client Prisma n'est chargé que si le test tourne. */
  const { PrismaClient } = await import('../packages/db/generated/client/index.js');
  const prisma = new PrismaClient();
  try {
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN', status: 'ACTIVE' } });
    // Le rôle est inscrit dans la session : on la ferme pour qu'il prenne effet.
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Active la double authentification si l'espace admin la réclame, et renvoie
 * la clé. La réponse du premier appel de l'espace admin tranche : 403, il la
 * réclame et le site conduit à la page d'activation ; 200, il n'en veut pas.
 */
async function enrolIfAsked(page: Page, firstAdminCall: Promise<number>): Promise<string | null> {
  if ((await firstAdminCall) !== 403) return null;
  await page.waitForURL(/\/double-authentification/);

  await page.getByRole('button', { name: 'Activer la double authentification' }).click();
  await expect(page.getByAltText(/QR code/)).toBeVisible();
  const secret = (await page.getByLabel('Clé de configuration').innerText()).replace(/\s/g, '');

  await page.getByLabel('Code à 6 chiffres').fill(totp(secret));
  await page.getByRole('button', { name: 'Activer la double authentification' }).click();

  await expect(page.getByText('Vos codes de secours')).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(10);
  await page.getByRole('button', { name: /J.ai mis mes codes à l.abri/ }).click();
  return secret;
}

async function adminWithSession(page: Page): Promise<{ account: TestAccount; secret: string | null }> {
  const account = newAccount('admin.navigateur');
  await register(page, account);
  await makeAdmin(account.email);

  // La connexion mène l'admin chez lui, `/admin`, qui interroge aussitôt l'API.
  const firstAdminCall = page
    .waitForResponse((response) => response.url().includes('/api/v1/admin/'))
    .then((response) => response.status());
  await submitLogin(page, account.email);
  const secret = await enrolIfAsked(page, firstAdminCall);
  await expect(page).toHaveURL(/\/admin/);
  return { account, secret };
}

test('un administrateur ouvre son espace et voit son équipe', async ({ page }) => {
  await adminWithSession(page);

  await page.goto('/admin/equipe');
  await expect(page.getByRole('heading', { name: 'Administrateurs' })).toBeVisible();
  await expect(page.getByText('Vous', { exact: true })).toBeVisible();

  // L'admin voit le site public comme un visiteur, pour pouvoir le contrôler.
  await page.goto('/a-propos');
  const header = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(header.getByRole('link', { name: 'Vendre sur Ojà' })).toBeVisible();
});

test('la double authentification est demandée à la connexion suivante', async ({
  page,
  context,
}) => {
  const { account, secret } = await adminWithSession(page);
  test.skip(secret === null, 'Double authentification non exigée par cette API');

  await context.clearCookies();
  await submitLogin(page, account.email);

  // Le mot de passe seul n'ouvre plus rien : le code est demandé.
  await expect(page.getByText('Double authentification', { exact: true })).toBeVisible();
  // Le code de l'activation est consommé : on prend celui du pas suivant.
  await page.getByLabel('Code', { exact: true }).fill(totp(secret!, 1));
  await page.getByRole('button', { name: 'Valider' }).click();

  await expect(page).toHaveURL(/\/admin/);
  await page.goto('/admin/equipe');
  await expect(page.getByRole('heading', { name: 'Administrateurs' })).toBeVisible();
});

test('un client n’entre pas dans l’espace administrateur', async ({ page }) => {
  await register(page, newAccount('client.curieux'));
  await page.goto('/admin');
  await expect(page).not.toHaveURL(/\/admin/);
});
