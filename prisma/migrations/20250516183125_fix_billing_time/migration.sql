-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('CREDIT_CARD', 'BOLETO', 'PIX');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingType" "BillingType" NOT NULL DEFAULT 'CREDIT_CARD';
