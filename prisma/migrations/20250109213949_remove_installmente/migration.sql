/*
  Warnings:

  - You are about to drop the column `quotationPaymentId` on the `installments` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "installments" DROP CONSTRAINT "installments_quotationPaymentId_fkey";

-- AlterTable
ALTER TABLE "installments" DROP COLUMN "quotationPaymentId";
