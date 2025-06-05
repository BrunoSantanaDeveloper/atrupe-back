-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PROVISIONED';

-- AlterTable
ALTER TABLE "payable_installments" ADD COLUMN     "provisionDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "receivable_installments" ADD COLUMN     "provisionDate" TIMESTAMP(3);
