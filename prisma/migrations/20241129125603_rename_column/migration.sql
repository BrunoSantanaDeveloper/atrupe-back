-- AlterTable
ALTER TABLE "bank_account_cash_controls" ADD COLUMN     "cashRegisterId" TEXT;

-- AddForeignKey
ALTER TABLE "bank_account_cash_controls" ADD CONSTRAINT "bank_account_cash_controls_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
