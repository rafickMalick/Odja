import { defineConfig, devices } from '@playwright/test';

/**
 * Tests navigateur : les parcours tels qu'une personne les vit, de bout en
 * bout — site, API et base réels, rien de simulé hormis le fournisseur de
 * paiement (déjà simulé par l'API tant que Kadev Pay n'est pas branché).
 *
 * Ils supposent le site sur :3000 et l'API sur :4000, déjà démarrés, avec le
 * jeu de démonstration chargé (`npm run db:demo`). La CI s'en charge ; en
 * local : `./start.sh --demo`, puis `npm run test:browser`.
 */
export default defineConfig({
  testDir: '.',
  /* Un seul navigateur à la fois : les parcours partagent la base, comme les
     tests de bout en bout de l'API. */
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:3000',
    locale: 'fr-FR',
    /* En cas d'échec, de quoi comprendre sans relancer : la trace rejoue
       chaque étape, réseau compris. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
