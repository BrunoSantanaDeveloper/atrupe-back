-- CreateEnum
CREATE TYPE "BankAccountCashControlType" AS ENUM ('PAYSOFF', 'PROVISION');

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "cashControl" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bank_account_cash_controls" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "acceptPayments" BOOLEAN NOT NULL DEFAULT true,
    "paymentType" "BankAccountCashControlType" NOT NULL DEFAULT 'PAYSOFF',
    "acceptIncomes" BOOLEAN NOT NULL DEFAULT true,
    "incomeType" "BankAccountCashControlType" NOT NULL DEFAULT 'PAYSOFF',
    "paymentMethodId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,

    CONSTRAINT "bank_account_cash_controls_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "bank_account_cash_controls" ADD CONSTRAINT "bank_account_cash_controls_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_cash_controls" ADD CONSTRAINT "bank_account_cash_controls_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
