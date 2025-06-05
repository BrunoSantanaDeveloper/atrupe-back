-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "employeeId" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "rg" TEXT;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
