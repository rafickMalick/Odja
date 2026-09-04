/**
 * Refuse les migrations qui suppriment un objet créé en SQL brut.
 *
 * Pourquoi ce script existe : `searchVector` est déclarée `Unsupported("tsvector")`
 * dans le schéma Prisma, et son index GIN est créé à la main. Prisma ne
 * comprend ni l'une ni l'autre, si bien qu'il propose un
 * `DROP INDEX "products_search_idx"` dans **chaque** migration touchant la
 * table `products`. C'est arrivé deux fois en deux migrations.
 *
 * Laisser passer ce DROP ne casserait rien de visible : la recherche
 * continuerait de répondre, en balayage séquentiel, jusqu'à s'effondrer sur un
 * vrai volume de catalogue. C'est précisément le genre de régression qu'une
 * relecture humaine laisse passer — d'où ce contrôle mécanique.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = new URL('../prisma/migrations', import.meta.url).pathname;

/** Objets créés hors du schéma Prisma, qu'aucune migration ne doit supprimer. */
const PROTECTED = [
  { pattern: /DROP\s+INDEX\s+"?products_search_idx"?/i, name: 'products_search_idx (index GIN de recherche)' },
  { pattern: /DROP\s+TRIGGER\s+[^;]*ledger_entries_no_(update|delete)/i, name: 'immuabilité du grand livre (invariant I4)' },
  { pattern: /DROP\s+TRIGGER\s+[^;]*ledger_entries_balanced/i, name: 'équilibre des transactions (invariant I1)' },
  { pattern: /DROP\s+TRIGGER\s+[^;]*products_search_vector/i, name: 'rafraîchissement du vecteur de recherche' },
  { pattern: /DROP\s+EXTENSION\s+[^;]*unaccent/i, name: 'extension unaccent' },
];

const violations = [];

for (const dir of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;

  const file = join(MIGRATIONS_DIR, dir.name, 'migration.sql');
  let sql;
  try {
    sql = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  /* On ignore le commentaire sous ses deux formes. Les migrations expliquent
     volontiers pourquoi tel DROP a été retiré, et cette explication ne doit
     pas déclencher l'alerte : un garde qui se plaint de la prose finit
     désactivé, et c'est alors la vraie régression qui passe. */
  const active = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  for (const { pattern, name } of PROTECTED) {
    if (pattern.test(active)) {
      violations.push({ migration: dir.name, name });
    }
  }
}

if (violations.length > 0) {
  console.error('\n✖ Migration refusée — elle supprime un objet créé en SQL brut :\n');
  for (const v of violations) {
    console.error(`  · ${v.migration}`);
    console.error(`    supprime : ${v.name}\n`);
  }
  console.error(
    'Retirez ce DROP de la migration. Prisma le régénère parce qu\'il ne\n' +
      'comprend pas les objets définis hors de son schéma — ce n\'est pas\n' +
      'une intention, c\'est un angle mort.\n',
  );
  process.exit(1);
}

console.log(`✓ ${readdirSync(MIGRATIONS_DIR).length - 1} migrations vérifiées, aucun DROP interdit`);
