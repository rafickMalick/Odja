-- AlterTable
ALTER TABLE "courier_profiles" ADD COLUMN     "kycRejectReason" TEXT,
ADD COLUMN     "kycReviewedAt" TIMESTAMP(3),
ADD COLUMN     "kycSubmittedAt" TIMESTAMP(3);

/* Prisma a émis un `DROP INDEX products_search_idx` en générant cette
   migration — la quatrième fois. Il ne comprend pas les objets définis en SQL
   brut sur une colonne `Unsupported("tsvector")`, et les considère comme des
   restes à nettoyer. Le DROP a été retiré, mais il avait déjà été appliqué en
   développement : on rétablit l'index ici pour que toute base ayant joué cette
   migration le retrouve, quel que soit l'ordre. */
CREATE INDEX IF NOT EXISTS products_search_idx ON products USING GIN ("searchVector");
