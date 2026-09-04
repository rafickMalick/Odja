-- Garde-fous que le schéma Prisma ne sait pas exprimer.
-- Ils vivent en base parce qu'une règle appliquée uniquement par le code
-- applicatif est contournée par la première migration de données écrite à la
-- main, par un script d'exploitation ou par un futur service.

-- ════════════════════════════════════════════════════════════════════
-- Invariant I4 — le grand livre est immuable
-- ════════════════════════════════════════════════════════════════════
-- Une écriture comptable ne se corrige pas : on contre-passe. Toute tentative
-- de modification ou de suppression est refusée par la base elle-même.

CREATE OR REPLACE FUNCTION ledger_entries_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries est immuable (invariant I4) : une écriture se contre-passe, elle ne se % pas',
    lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

-- ════════════════════════════════════════════════════════════════════
-- Invariant I1 — la somme des écritures d'une transaction vaut zéro
-- ════════════════════════════════════════════════════════════════════
-- Le contrôle est DÉFÉRÉ à la fin de la transaction SQL : au moment où la
-- première ligne est insérée, la somme ne peut évidemment pas être nulle.
-- Une transaction comptable est donc valide ou n'existe pas — jamais à moitié
-- écrite.

CREATE OR REPLACE FUNCTION ledger_transaction_balanced()
RETURNS TRIGGER AS $$
DECLARE
  total BIGINT;
  n     INTEGER;
BEGIN
  SELECT COALESCE(SUM("amountXof"), 0), COUNT(*)
    INTO total, n
    FROM ledger_entries
   WHERE "transactionId" = NEW."transactionId";

  IF n > 0 AND total <> 0 THEN
    RAISE EXCEPTION
      'transaction comptable déséquilibrée (invariant I1) : % lignes, somme = % XOF au lieu de 0',
      n, total;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_transaction_balanced();

-- ════════════════════════════════════════════════════════════════════
-- Recherche plein texte du catalogue
-- ════════════════════════════════════════════════════════════════════
-- `unaccent` doit être appliqué côté serveur exactement comme le front le fait
-- côté client, sinon les deux jeux de résultats divergent sur « Sènou ».

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION products_search_vector_refresh()
RETURNS TRIGGER AS $$
BEGIN
  NEW."searchVector" :=
      setweight(to_tsvector('french', unaccent(coalesce(NEW.name, ''))), 'A')
   || setweight(to_tsvector('french', unaccent(coalesce(NEW.material, ''))), 'B')
   || setweight(to_tsvector('french', unaccent(coalesce(NEW.description, ''))), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_search_vector
  BEFORE INSERT OR UPDATE OF name, material, description ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_vector_refresh();

CREATE INDEX products_search_idx ON products USING GIN ("searchVector");

-- ════════════════════════════════════════════════════════════════════
-- Cohérence des montants
-- ════════════════════════════════════════════════════════════════════
-- Le modèle du cahier client : la commission s'AJOUTE au prix du créateur.
-- Une ligne de commande dont le prix final ne serait pas la somme exacte des
-- deux serait une erreur de calcul silencieuse, et elle se retrouverait à la
-- fois sur la facture du client et sur le versement du créateur.

ALTER TABLE order_lines
  ADD CONSTRAINT order_lines_final_price_is_sum
  CHECK ("finalPriceXof" = "makerPriceXof" + "commissionXof");

ALTER TABLE order_lines
  ADD CONSTRAINT order_lines_total_is_product
  CHECK ("lineTotalXof" = "finalPriceXof" * quantity);

ALTER TABLE orders
  ADD CONSTRAINT orders_items_final_is_sum
  CHECK ("itemsFinalTotalXof" = "itemsMakerTotalXof" + "commissionTotalXof");

ALTER TABLE orders
  ADD CONSTRAINT orders_total_is_sum
  CHECK ("totalXof" = "itemsFinalTotalXof" + "deliveryTotalXof" + "vatXof");

-- Aucun montant négatif nulle part : un prix, une commission ou des frais de
-- livraison négatifs n'ont pas de sens et ne se rattrapent pas plus loin.
ALTER TABLE order_lines
  ADD CONSTRAINT order_lines_amounts_positive
  CHECK ("makerPriceXof" >= 0 AND "commissionXof" >= 0 AND quantity > 0);

ALTER TABLE products
  ADD CONSTRAINT products_price_positive CHECK ("makerPriceXof" >= 0);

ALTER TABLE products
  ADD CONSTRAINT products_stock_coherent
  CHECK ("quantityAvailable" >= 0 AND "quantityReserved" >= 0);

-- Un produit fabriqué sur commande doit annoncer son délai : c'est lui qui
-- arme le compte à rebours « En fabrication » vu par le créateur et le client.
ALTER TABLE products
  ADD CONSTRAINT products_lead_time_when_made_to_order
  CHECK (NOT "isMadeToOrder" OR "leadTimeDays" IS NOT NULL);
