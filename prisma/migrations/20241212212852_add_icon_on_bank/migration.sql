/*
  Warnings:

  - You are about to drop the column `observation` on the `cash_registers` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "bank_account_cash_controls" ADD COLUMN     "acceptMultipleCashRegisters" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "cash_registers" DROP COLUMN "observation",
ADD COLUMN     "notes" TEXT;
