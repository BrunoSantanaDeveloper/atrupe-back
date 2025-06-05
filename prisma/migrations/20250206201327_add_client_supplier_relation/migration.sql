-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "supplierId" TEXT;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
