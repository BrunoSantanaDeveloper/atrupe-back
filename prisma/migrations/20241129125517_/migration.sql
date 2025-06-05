/*
  Warnings:

  - You are about to drop the column `cashRegisterId` on the `bank_account_cash_controls` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "bank_account_cash_controls" DROP CONSTRAINT "bank_account_cash_controls_cashRegisterId_fkey";

-- AlterTable
ALTER TABLE "bank_account_cash_controls" DROP COLUMN "cashRegisterId";
