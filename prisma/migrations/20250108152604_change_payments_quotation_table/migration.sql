/*
  Warnings:

  - The `billing` column on the `quotation_payments` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('NFE', 'NFSE', 'OTHER');

-- AlterTable
ALTER TABLE "installments" ALTER COLUMN "operatorFeeRate" SET DEFAULT 0,
ALTER COLUMN "operatorFeeTransfer" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "quotation_payments" ADD COLUMN     "discountType" TEXT NOT NULL DEFAULT 'VALUE',
ADD COLUMN     "downPaymentType" TEXT NOT NULL DEFAULT 'VALUE',
ADD COLUMN     "type" "InvoiceType" NOT NULL DEFAULT 'OTHER',
DROP COLUMN "billing",
ADD COLUMN     "billing" "BiilingKind" NOT NULL DEFAULT 'ON_ORDER';
