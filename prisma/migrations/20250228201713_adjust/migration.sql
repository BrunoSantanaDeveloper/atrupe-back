-- AlterTable
ALTER TABLE "quotation_payments" ADD COLUMN     "additionalFeeType" TEXT,
ADD COLUMN     "installmentQty" INTEGER,
ADD COLUMN     "mainAdditionalFee" DOUBLE PRECISION,
ADD COLUMN     "maxInstallmentQty" INTEGER,
ADD COLUMN     "minInstallmentQty" INTEGER;
