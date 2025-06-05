/*
  Warnings:

  - Added the required column `companyId` to the `SalarySheet` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SalarySheet" ADD COLUMN     "companyId" TEXT NOT NULL,
ALTER COLUMN "updatedAt" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SalarySheet" ADD CONSTRAINT "SalarySheet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
