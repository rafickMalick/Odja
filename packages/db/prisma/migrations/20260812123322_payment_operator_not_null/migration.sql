-- `operator` devient NOT NULL avec '' pour défaut.
--
-- Pourquoi : PostgreSQL ne fait jamais entrer deux NULL en conflit dans une
-- contrainte d'unicité. Tant que `operator` était nullable, la contrainte
-- (countryId, channel, operator) laissait se dupliquer autant de lignes
-- « carte bancaire » qu'on rejouait le seed. Le bug a été attrapé en rejouant
-- le seed deux fois : 5 moyens de paiement au premier passage, 6 au second.

UPDATE payment_method_configs SET operator = '' WHERE operator IS NULL;

ALTER TABLE "payment_method_configs"
  ALTER COLUMN "operator" SET NOT NULL,
  ALTER COLUMN "operator" SET DEFAULT '';

-- ATTENTION — Prisma avait généré ici un `DROP INDEX "products_search_idx"`.
-- Il a été retiré volontairement.
--
-- Cet index GIN est créé en SQL brut dans la migration
-- 20260812022404_guards_ledger_and_search, sur une colonne déclarée
-- `Unsupported("tsvector")`. Prisma ne la comprend pas, donc il considère
-- l'index comme un résidu à supprimer et le proposera à CHAQUE migration
-- future touchant la table `products`.
--
-- Le laisser passer supprimerait l'index sans rien casser visiblement : la
-- recherche continuerait de répondre, en séquentiel, jusqu'à s'effondrer sur
-- un vrai volume de catalogue.
--
-- ⇒ Relire toute migration générée qui touche `products` et retirer ce DROP.
