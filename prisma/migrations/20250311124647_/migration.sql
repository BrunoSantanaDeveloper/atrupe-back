-- DropForeignKey
ALTER TABLE "payable_installments" DROP CONSTRAINT "payable_installments_paymentMethodId_fkey";

-- DropForeignKey
ALTER TABLE "receivable_installments" DROP CONSTRAINT "receivable_installments_paymentMethodId_fkey";

-- AlterTable
ALTER TABLE "payable_installments" ALTER COLUMN "paymentMethodId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "receivable_installments" ALTER COLUMN "paymentMethodId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
