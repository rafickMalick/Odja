-- CreateEnum
CREATE TYPE "ExhibitionPassKind" AS ENUM ('REGISTRATION', 'TICKET', 'INVITATION');

-- CreateEnum
CREATE TYPE "ExhibitionPassStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExhibitionPassFormat" AS ENUM ('ONSITE', 'ONLINE');


-- CreateTable
CREATE TABLE "exhibition_passes" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "exhibitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ExhibitionPassKind" NOT NULL,
    "format" "ExhibitionPassFormat" NOT NULL,
    "status" "ExhibitionPassStatus" NOT NULL,
    "amountXof" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exhibition_passes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exhibition_passes_reference_key" ON "exhibition_passes"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "exhibition_passes_providerRef_key" ON "exhibition_passes"("providerRef");

-- CreateIndex
CREATE INDEX "exhibition_passes_exhibitionId_status_idx" ON "exhibition_passes"("exhibitionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exhibition_passes_exhibitionId_userId_format_key" ON "exhibition_passes"("exhibitionId", "userId", "format");

-- AddForeignKey
ALTER TABLE "exhibition_passes" ADD CONSTRAINT "exhibition_passes_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "exhibitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exhibition_passes" ADD CONSTRAINT "exhibition_passes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
