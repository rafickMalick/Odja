-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('ONLINE_FULL', 'DEPOSIT_50', 'CASH_ON_DELIVERY');

-- AlterEnum
ALTER TYPE "LedgerAccountType" ADD VALUE 'RECEIVABLE_ON_DELIVERY';
ALTER TYPE "LedgerAccountType" ADD VALUE 'COURIER_CASH_HELD';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'ONLINE_FULL',
ADD COLUMN     "upfrontXof" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "balanceXof" INTEGER NOT NULL DEFAULT 0;

-- Les commandes existantes ont toutes été réglées en ligne, en totalité.
UPDATE "orders" SET "upfrontXof" = "totalXof";

-- AlterTable
ALTER TABLE "sub_orders" ADD COLUMN     "balanceDueXof" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cashCollectedAt" TIMESTAMP(3),
ADD COLUMN     "cashCollectedXof" INTEGER;

-- Un remboursement peut ne pas avoir de paiement en ligne (paiement à la livraison).
ALTER TABLE "refunds" ALTER COLUMN "paymentId" DROP NOT NULL,
ADD COLUMN     "orderId" TEXT;

UPDATE "refunds" r SET "orderId" = p."orderId" FROM "payments" p WHERE r."paymentId" = p.id;

CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
