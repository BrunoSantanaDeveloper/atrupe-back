-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "quotationId" TEXT;

-- AlterTable
ALTER TABLE "quotation_installments" ADD COLUMN     "payableInstallmentId" TEXT,
ADD COLUMN     "receivableInstallmentId" TEXT;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "quotationId" TEXT;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_payableInstallmentId_fkey" FOREIGN KEY ("payableInstallmentId") REFERENCES "payable_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_receivableInstallmentId_fkey" FOREIGN KEY ("receivableInstallmentId") REFERENCES "receivable_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
