/*
  Warnings:

  - You are about to drop the column `addressId` on the `clients` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_addressId_fkey";

-- AlterTable
ALTER TABLE "addresses" ALTER COLUMN "ownerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "clients" DROP COLUMN "addressId";

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
