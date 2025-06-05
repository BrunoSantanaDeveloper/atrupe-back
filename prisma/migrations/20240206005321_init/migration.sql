-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('APPROVED', 'OPEN', 'CLOSED', 'CANCELED');

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "status" "QuotationStatus" NOT NULL DEFAULT 'OPEN';
