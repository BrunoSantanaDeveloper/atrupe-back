-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "principalCompanyId" TEXT;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_principalCompanyId_fkey" FOREIGN KEY ("principalCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
