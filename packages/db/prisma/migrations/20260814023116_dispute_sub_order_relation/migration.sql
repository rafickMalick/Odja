-- Relation Dispute → SubOrder.
--
-- La réclamation vise une sous-commande précise : c'est elle qui porte le
-- créateur, le montant et la livraison en cause. Sans cette relation, il
-- fallait deux requêtes pour savoir de quel atelier on parle.
--
-- NOTE : Prisma a de nouveau glissé ici un `DROP INDEX "products_search_idx"`.
-- Troisième fois. Retiré — `npm run db:check-migrations` le refuserait de
-- toute façon.

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "sub_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
