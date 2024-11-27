-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "cancelReason" TEXT;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "cancelReason" TEXT;
