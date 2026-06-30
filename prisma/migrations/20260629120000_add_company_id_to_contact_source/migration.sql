-- AlterTable
ALTER TABLE "contact_sources" ADD COLUMN "companyId" TEXT;

-- AddForeignKey
ALTER TABLE "contact_sources" ADD CONSTRAINT "contact_sources_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
