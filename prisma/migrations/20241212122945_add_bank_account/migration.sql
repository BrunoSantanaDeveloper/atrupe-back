-- AlterTable
ALTER TABLE "payable_installments" ADD COLUMN     "bankAccountId" TEXT,
ALTER COLUMN "updatedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "receivable_installments" ADD COLUMN     "bankAccountId" TEXT,
ALTER COLUMN "updatedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
