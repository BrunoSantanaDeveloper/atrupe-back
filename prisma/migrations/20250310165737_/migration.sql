-- DropForeignKey
ALTER TABLE "commissions" DROP CONSTRAINT "commissions_receivableId_fkey";

-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "payableId" TEXT;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
