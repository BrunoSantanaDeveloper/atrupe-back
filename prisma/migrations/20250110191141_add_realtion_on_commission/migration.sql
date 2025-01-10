-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "receivableId" TEXT;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
