/*
  Warnings:

  - Added the required column `companyId` to the `natures` table without a default value. This is not possible if the table is not empty.
  - Added the required column `companyId` to the `sub_categories` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "natures" ADD COLUMN     "companyId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "sub_categories" ADD COLUMN     "companyId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "natures" ADD CONSTRAINT "natures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
