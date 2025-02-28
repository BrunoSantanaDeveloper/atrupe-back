/*
  Warnings:

  - You are about to drop the column `discount` on the `quotation_payments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "quotation_payments" DROP COLUMN "discount",
ADD COLUMN     "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0;
