/*
  Warnings:

  - You are about to drop the column `quotatioDuration` on the `sale_series` table. All the data in the column will be lost.
  - Added the required column `quotationDuration` to the `sale_series` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sale_series" DROP COLUMN "quotatioDuration",
ADD COLUMN     "quotationDuration" INTEGER NOT NULL;
