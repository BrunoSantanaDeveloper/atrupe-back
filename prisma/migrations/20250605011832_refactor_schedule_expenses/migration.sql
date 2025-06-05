/*
  Warnings:

  - You are about to drop the column `dueDate` on the `scheduled_expenses` table. All the data in the column will be lost.
  - You are about to drop the `SalaryControl` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "RecurringType" AS ENUM ('WEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY', 'ONCE');

-- DropForeignKey
ALTER TABLE "SalaryControl" DROP CONSTRAINT "SalaryControl_companyId_fkey";

-- DropForeignKey
ALTER TABLE "SalaryControl" DROP CONSTRAINT "SalaryControl_employeeId_fkey";

-- AlterTable
ALTER TABLE "scheduled_expenses" DROP COLUMN "dueDate",
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "dueDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "recurringType" "RecurringType" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "subCategoryId" TEXT,
ADD COLUMN     "supplierId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "description" DROP NOT NULL,
ALTER COLUMN "amount" SET DEFAULT 0;

-- DropTable
DROP TABLE "SalaryControl";

-- CreateTable
CREATE TABLE "salary_controls" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "type" "ItemType" NOT NULL DEFAULT 'INCREASE',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "salary_controls_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "salary_controls" ADD CONSTRAINT "salary_controls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_controls" ADD CONSTRAINT "salary_controls_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
