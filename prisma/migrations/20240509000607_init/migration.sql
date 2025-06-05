/*
  Warnings:

  - You are about to drop the column `mobilePhone` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `phoneNumber` on the `contacts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "mobilePhone",
DROP COLUMN "phoneNumber",
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "phone" TEXT;
