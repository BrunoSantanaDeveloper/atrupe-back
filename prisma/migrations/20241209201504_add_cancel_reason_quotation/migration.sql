-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "reasonId" TEXT;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
