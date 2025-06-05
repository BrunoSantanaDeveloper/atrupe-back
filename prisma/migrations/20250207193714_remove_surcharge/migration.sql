/*
  Warnings:

  - You are about to drop the column `surcharge` on the `quotation_installments` table. All the data in the column will be lost.
  - You are about to drop the column `downPaymentSurcharge` on the `quotation_payments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "quotation_installments" DROP COLUMN "surcharge",
ADD COLUMN     "additionalFee" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "quotation_payments" DROP COLUMN "downPaymentSurcharge",
ADD COLUMN     "downPaymentAdditionalFee" DOUBLE PRECISION NOT NULL DEFAULT 0;
