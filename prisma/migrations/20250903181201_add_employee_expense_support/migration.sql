-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('SUPPLIER', 'EMPLOYEE', 'CLIENT', 'OTHER');

-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "expenseSource" "ExpenseSource" NOT NULL DEFAULT 'OTHER';

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
