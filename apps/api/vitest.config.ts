import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * NestJS résout les dépendances d'un constructeur à partir des **métadonnées
 * de décorateur** émises par TypeScript. L'esbuild embarqué dans Vitest ne les
 * produit pas : sans SWC ici, chaque paramètre injecté arrive à `undefined` et
 * les tests échouent sur des erreurs de dépendance sans rapport avec le code
 * testé.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    /* La suite martèle volontairement la connexion depuis une seule adresse :
       la limitation de débit y verrait une attaque, à juste titre. Son
       comportement est couvert par ses propres tests unitaires, qui
       l'instancient directement. */
    env: { RATE_LIMIT_ENABLED: 'false' },
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    /* Les tests de bout en bout partagent une base PostgreSQL : les faire
       tourner en parallèle produirait des interférences entre fichiers, avec
       des échecs qui n'apparaissent qu'une fois sur trois. */
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
