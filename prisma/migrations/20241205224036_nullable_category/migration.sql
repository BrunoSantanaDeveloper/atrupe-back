-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_supplierId_fkey";

-- AlterTable
ALTER TABLE "payables" ALTER COLUMN "categoryId" DROP NOT NULL,
ALTER COLUMN "supplierId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "totalValue" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
