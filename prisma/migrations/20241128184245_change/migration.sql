/*
  Warnings:

  - Changed the type of `month` on the `SalarySheet` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "SalarySheet" DROP COLUMN "month",
ADD COLUMN     "month" INTEGER NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'EMPTY';

-- CreateIndex
CREATE UNIQUE INDEX "SalarySheet_employeeId_month_year_key" ON "SalarySheet"("employeeId", "month", "year");
