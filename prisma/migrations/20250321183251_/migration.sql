-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "mainAdditionalFee" DOUBLE PRECISION,
ADD COLUMN     "totalValue" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "mainAdditionalFee" DOUBLE PRECISION,
ALTER COLUMN "totalAmount" DROP NOT NULL;
