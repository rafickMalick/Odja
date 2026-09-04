-- AlterTable
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

/* Prisma a de nouveau proposé un `DROP INDEX products_search_idx` — la
   cinquième fois. Il ne comprend pas les objets définis en SQL brut sur une
   colonne `Unsupported("tsvector")`, et les prend pour des restes à
   nettoyer. Retiré ici ; voir la migration guards_ledger_and_search pour
   l'origine de l'index et check-migrations.mjs pour le garde qui l'attrape. */
CREATE INDEX IF NOT EXISTS products_search_idx ON products USING GIN ("searchVector");
