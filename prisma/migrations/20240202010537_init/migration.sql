/*
  Warnings:

  - You are about to drop the column `quotaDuration` on the `sale_series` table. All the data in the column will be lost.
  - Added the required column `quotatioDuration` to the `sale_series` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sale_series" DROP COLUMN "quotaDuration",
ADD COLUMN     "quotatioDuration" INTEGER NOT NULL;
