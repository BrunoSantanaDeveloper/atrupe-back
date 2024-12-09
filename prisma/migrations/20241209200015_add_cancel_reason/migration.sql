-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "reasonsId" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reasonsId_fkey" FOREIGN KEY ("reasonsId") REFERENCES "reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
