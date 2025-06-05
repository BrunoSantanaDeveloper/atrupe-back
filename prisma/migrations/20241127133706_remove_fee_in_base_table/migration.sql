/*
  Warnings:

  - You are about to drop the column `operatorFeeRate` on the `payment_conditions` table. All the data in the column will be lost.
  - You are about to drop the column `operatorFeeTransfer` on the `payment_conditions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "payment_conditions" DROP COLUMN "operatorFeeRate",
DROP COLUMN "operatorFeeTransfer";
