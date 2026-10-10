-- CreateEnum
CREATE TYPE "ExhibitionFormat" AS ENUM ('PHYSICAL', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "ExhibitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'REJECTED', 'ACCEPTED', 'SCHEDULED', 'PUBLISHED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ExhibitionAccess" AS ENUM ('FREE', 'PAID', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "ExhibitionWorkReview" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');


-- CreateTable
CREATE TABLE "exhibition_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxWorks" INTEGER,
    "maxDurationDays" INTEGER,
    "priceXof" INTEGER NOT NULL DEFAULT 0,
    "perks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featuredPlacement" BOOLEAN NOT NULL DEFAULT false,
    "communicationSupport" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exhibition_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exhibitions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "makerId" TEXT,
    "planId" TEXT,
    "title" TEXT NOT NULL,
    "organizerName" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "objective" TEXT,
    "discipline" TEXT,
    "cityId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "openingHours" TEXT,
    "format" "ExhibitionFormat" NOT NULL,
    "venueName" TEXT,
    "venueAddress" TEXT,
    "venueDescription" TEXT,
    "venueImageKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coverKey" TEXT,
    "dossierKey" TEXT,
    "plannedWorkCount" INTEGER,
    "status" "ExhibitionStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "contractReference" TEXT,
    "contractSentAt" TIMESTAMP(3),
    "contractSignedAt" TIMESTAMP(3),
    "paymentAmountXof" INTEGER,
    "paymentReference" TEXT,
    "paymentReceivedAt" TIMESTAMP(3),
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,
    "accessMode" "ExhibitionAccess" NOT NULL DEFAULT 'FREE',
    "ticketPriceXof" INTEGER NOT NULL DEFAULT 0,
    "requiresRegistration" BOOLEAN NOT NULL DEFAULT false,
    "accessCodeHash" TEXT,
    "onsiteInfo" TEXT,
    "remoteInfo" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exhibitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exhibition_works" (
    "id" TEXT NOT NULL,
    "exhibitionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "materials" TEXT,
    "dimensions" TEXT,
    "imageKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proofKey" TEXT,
    "reviewStatus" "ExhibitionWorkReview" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exhibition_works_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exhibition_plans_code_key" ON "exhibition_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "exhibitions_slug_key" ON "exhibitions"("slug");

-- CreateIndex
CREATE INDEX "exhibitions_status_startsAt_idx" ON "exhibitions"("status", "startsAt");

-- CreateIndex
CREATE INDEX "exhibitions_organizerId_idx" ON "exhibitions"("organizerId");

-- CreateIndex
CREATE INDEX "exhibition_works_exhibitionId_position_idx" ON "exhibition_works"("exhibitionId", "position");

-- AddForeignKey
ALTER TABLE "exhibitions" ADD CONSTRAINT "exhibitions_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exhibitions" ADD CONSTRAINT "exhibitions_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "maker_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exhibitions" ADD CONSTRAINT "exhibitions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "exhibition_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exhibitions" ADD CONSTRAINT "exhibitions_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exhibition_works" ADD CONSTRAINT "exhibition_works_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "exhibitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exhibition_works" ADD CONSTRAINT "exhibition_works_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Formules d'exposition initiales (cahier des évolutions, § 6.6). Leurs
-- différences et leurs prix se règlent ensuite dans l'administration ; les
-- prix restent à 0 tant qu'Ojà ne les a pas fixés.
INSERT INTO "exhibition_plans" ("id", "code", "name", "description", "maxWorks", "maxDurationDays", "priceXof", "perks", "featuredPlacement", "communicationSupport", "position", "updatedAt")
VALUES
  ('expo_standard', 'standard', 'Standard', 'Exposition numérique avec les fonctions de présentation de base.', 20, 30, 0,
   ARRAY['Jusqu''à 20 œuvres', 'Jusqu''à 30 jours en ligne', 'Page publique et lien partageable'], false, false, 0, CURRENT_TIMESTAMP),
  ('expo_premium', 'premium', 'Premium', 'Davantage d''œuvres, une durée plus longue et une visibilité renforcée.', 60, 90, 0,
   ARRAY['Jusqu''à 60 œuvres', 'Jusqu''à 90 jours en ligne', 'Mise en avant dans la rubrique Expositions'], true, false, 1, CURRENT_TIMESTAMP),
  ('expo_vip', 'vip', 'VIP', 'Pour les projets qui demandent un accompagnement et une mise en valeur plus importants.', NULL, NULL, 0,
   ARRAY['Œuvres et durée sans plafond', 'Mise en avant sur l''accueil d''Ojà', 'Accompagnement et communication par l''équipe Ojà'], true, true, 2, CURRENT_TIMESTAMP);
