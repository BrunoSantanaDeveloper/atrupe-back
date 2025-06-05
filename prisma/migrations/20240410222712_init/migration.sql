-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_clientId_fkey";

-- AlterTable
ALTER TABLE "quotations" ALTER COLUMN "clientId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
