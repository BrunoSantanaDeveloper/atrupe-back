/*
  Warnings:

  - You are about to drop the column `companyId` on the `addresses` table. All the data in the column will be lost.
  - Added the required column `ownerId` to the `addresses` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerType` to the `addresses` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "addresses" DROP CONSTRAINT "addresses_companyId_fkey";

-- AlterTable
ALTER TABLE "addresses" DROP COLUMN "companyId",
ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "ownerType" TEXT NOT NULL;
