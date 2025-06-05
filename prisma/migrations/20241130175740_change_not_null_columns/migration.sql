/*
  Warnings:

  - You are about to drop the column `invoiceId` on the `QuotationPayment` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "QuotationPayment" DROP CONSTRAINT "QuotationPayment_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationPayment" DROP CONSTRAINT "QuotationPayment_paymentConditionId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationPayment" DROP CONSTRAINT "QuotationPayment_paymentMethodId_fkey";

-- AlterTable
ALTER TABLE "QuotationPayment" DROP COLUMN "invoiceId",
ALTER COLUMN "billing" DROP NOT NULL,
ALTER COLUMN "paymentMethodId" DROP NOT NULL,
ALTER COLUMN "paymentConditionId" DROP NOT NULL,
ALTER COLUMN "updatedAt" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "QuotationPayment" ADD CONSTRAINT "QuotationPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationPayment" ADD CONSTRAINT "QuotationPayment_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
