-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "subCategoryId" TEXT;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
