-- CreateEnum
CREATE TYPE "CreatorKind" AS ENUM ('STUDIO', 'ARTISAN', 'DESIGNER', 'APPRENTICE_DESIGNER', 'APPRENTICE_ARTISAN');

-- CreateEnum
CREATE TYPE "ProductAvailability" AS ENUM ('AVAILABLE', 'SOLD', 'UNAVAILABLE');

-- AlterTable
ALTER TABLE "maker_profiles" ADD COLUMN     "activityField" TEXT,
ADD COLUMN     "creatorKind" "CreatorKind" NOT NULL DEFAULT 'ARTISAN',
ADD COLUMN     "publicArea" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "services" TEXT,
ADD COLUMN     "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "techniques" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "availability" "ProductAvailability" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "isForSale" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "visibility_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxPublications" INTEGER,
    "durationDays" INTEGER,
    "priceXof" INTEGER NOT NULL DEFAULT 0,
    "perks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "showBadge" BOOLEAN NOT NULL DEFAULT false,
    "boostInDirectory" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visibility_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maker_subscriptions" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "amountXof" INTEGER NOT NULL DEFAULT 0,
    "paymentReference" TEXT,
    "note" TEXT,
    "activatedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maker_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visibility_plans_code_key" ON "visibility_plans"("code");

-- CreateIndex
CREATE INDEX "maker_subscriptions_makerId_startsAt_idx" ON "maker_subscriptions"("makerId", "startsAt");

-- AddForeignKey
ALTER TABLE "maker_subscriptions" ADD CONSTRAINT "maker_subscriptions_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "maker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maker_subscriptions" ADD CONSTRAINT "maker_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "visibility_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Une seule formule par défaut : celle de qui n'a aucune souscription en cours.
CREATE UNIQUE INDEX "visibility_plans_single_default" ON "visibility_plans"("isDefault") WHERE "isDefault";

-- Formules initiales (cahier des évolutions, § 3). Quotas, durée, prix et
-- avantages se règlent ensuite depuis l'administration : le prix du Premium
-- reste à 0 tant qu'Ojà ne l'a pas fixé.
INSERT INTO "visibility_plans" ("id", "code", "name", "description", "maxPublications", "durationDays", "priceXof", "perks", "showBadge", "boostInDirectory", "isDefault", "position", "updatedAt")
VALUES
  ('plan_standard', 'standard', 'Standard', 'Le niveau d''accès classique à Ojà.', 20, NULL, 0,
   ARRAY['Profil public avec logo, bannière et présentation', 'Jusqu''à 20 fiches actives', 'Vente selon les conditions générales d''Ojà', 'Présence dans l''annuaire et la recherche'],
   false, false, true, 0, CURRENT_TIMESTAMP),
  ('plan_premium', 'premium', 'Premium', 'Une visibilité commerciale renforcée. Ce n''est pas une certification de qualité.', 100, 30, 0,
   ARRAY['Badge Premium sur le profil', 'Jusqu''à 100 fiches actives', 'Placement en tête de l''annuaire des créateurs', 'Éligible aux sélections et campagnes d''Ojà'],
   true, true, false, 1, CURRENT_TIMESTAMP);
