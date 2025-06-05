-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "subCompanyId" TEXT;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_subCompanyId_fkey" FOREIGN KEY ("subCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
