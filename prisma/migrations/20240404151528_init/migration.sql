-- AlterTable
ALTER TABLE "payment_conditions" ADD COLUMN     "installments" JSONB,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxInstallments" INTEGER,
ADD COLUMN     "minInstallments" INTEGER;
