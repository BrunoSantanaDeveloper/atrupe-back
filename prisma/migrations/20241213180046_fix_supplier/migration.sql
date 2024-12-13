/*
  Warnings:

  - You are about to drop the column `categoryId` on the `suppliers` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_categoryId_fkey";

-- AlterTable
ALTER TABLE "suppliers" DROP COLUMN "categoryId",
ADD COLUMN     "blockClient" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "maxValue" DOUBLE PRECISION,
ADD COLUMN     "minValue" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "supplier_payment_conditions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "supplierId" TEXT NOT NULL,
    "paymentConditionId" TEXT NOT NULL,

    CONSTRAINT "supplier_payment_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_conditions_supplierId_paymentConditionId_key" ON "supplier_payment_conditions"("supplierId", "paymentConditionId");

-- AddForeignKey
ALTER TABLE "supplier_payment_conditions" ADD CONSTRAINT "supplier_payment_conditions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_conditions" ADD CONSTRAINT "supplier_payment_conditions_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
