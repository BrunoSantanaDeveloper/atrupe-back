-- DropForeignKey
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_clientId_fkey";

-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "supplierId" TEXT,
ALTER COLUMN "clientId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
