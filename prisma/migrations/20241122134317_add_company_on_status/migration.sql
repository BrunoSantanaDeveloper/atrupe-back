/*
  Warnings:

  - Added the required column `companyId` to the `status_quotation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "status_quotation" ADD COLUMN     "companyId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "status_quotation" ADD CONSTRAINT "status_quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
