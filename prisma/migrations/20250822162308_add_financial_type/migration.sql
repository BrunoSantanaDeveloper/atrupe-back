-- CreateEnum
CREATE TYPE "FinancialType" AS ENUM ('MAIN', 'DOWN_PAYMENT', 'COMMISSION', 'DELIVERY');

-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "financialType" "FinancialType" NOT NULL DEFAULT 'MAIN';

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "financialType" "FinancialType" NOT NULL DEFAULT 'MAIN';
