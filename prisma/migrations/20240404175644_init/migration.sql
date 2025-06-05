/*
  Warnings:

  - You are about to drop the column `phone` on the `companies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "companies" DROP COLUMN "phone",
ADD COLUMN     "phoneNumber" TEXT;
