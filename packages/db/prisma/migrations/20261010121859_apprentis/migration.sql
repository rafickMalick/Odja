
-- AlterTable
ALTER TABLE "maker_profiles" ADD COLUMN     "trainingInstitution" TEXT,
ADD COLUMN     "trainingLevel" TEXT,
ADD COLUMN     "trainingSpecialty" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "packagingNotes" TEXT;
