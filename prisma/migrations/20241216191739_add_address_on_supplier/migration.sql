/*
  Warnings:

  - You are about to drop the column `addressId` on the `suppliers` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_addressId_fkey";

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "suppliers" DROP COLUMN "addressId";

-- CreateIndex
CREATE INDEX "addresses_supplierId_ownerType_idx" ON "addresses"("supplierId", "ownerType");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
