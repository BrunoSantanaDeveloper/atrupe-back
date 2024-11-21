-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "subCategoryId" TEXT;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
