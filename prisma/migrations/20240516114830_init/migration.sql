-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "addressId" TEXT,
ADD COLUMN     "birthdate" TIMESTAMP(3),
ADD COLUMN     "financialNotes" TEXT,
ADD COLUMN     "nickname" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "site" TEXT;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
