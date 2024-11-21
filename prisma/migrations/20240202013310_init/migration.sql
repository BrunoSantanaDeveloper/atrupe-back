/*
  Warnings:

  - Added the required column `companyId` to the `sale_series` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sale_series" ADD COLUMN     "companyId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "sale_series" ADD CONSTRAINT "sale_series_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
