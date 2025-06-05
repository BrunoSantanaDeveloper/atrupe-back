-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "sectorId" TEXT;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
