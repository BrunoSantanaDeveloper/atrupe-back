/*
  Warnings:

  - You are about to drop the column `refereceDate` on the `payables` table. All the data in the column will be lost.
  - You are about to drop the column `refereceDate` on the `receivables` table. All the data in the column will be lost.
  - Added the required column `referenceDate` to the `payables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `referenceDate` to the `receivables` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "payables" DROP COLUMN "refereceDate",
ADD COLUMN     "referenceDate" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "receivables" DROP COLUMN "refereceDate",
ADD COLUMN     "referenceDate" TIMESTAMP(3) NOT NULL;
