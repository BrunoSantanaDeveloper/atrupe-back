-- CreateEnum
CREATE TYPE "transferMethodComission" AS ENUM ('SINGLE', 'CONFORMING');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('ADD', 'SUB');

-- AlterTable
ALTER TABLE "installments" ADD COLUMN     "quotationPaymentId" TEXT;

-- CreateTable
CREATE TABLE "QuotationPayment" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "billing" TEXT NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downPayment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentMethodId" TEXT NOT NULL,
    "paymentConditionId" TEXT NOT NULL,
    "commissionId" TEXT,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "finalValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "invoiceId" TEXT,

    CONSTRAINT "QuotationPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "type" "CommissionType" NOT NULL DEFAULT 'ADD',
    "transferMethod" "transferMethodComission" NOT NULL DEFAULT 'SINGLE',
    "commissionValue" DOUBLE PRECISION,
    "totalCommission" DOUBLE PRECISION,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationInstallment" (
    "id" TEXT NOT NULL,
    "quotationPaymentId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "surcharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotationPayment_quotationId_key" ON "QuotationPayment"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationPayment_commissionId_key" ON "QuotationPayment"("commissionId");

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_quotationPaymentId_fkey" FOREIGN KEY ("quotationPaymentId") REFERENCES "QuotationPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationPayment" ADD CONSTRAINT "QuotationPayment_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationPayment" ADD CONSTRAINT "QuotationPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationPayment" ADD CONSTRAINT "QuotationPayment_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationPayment" ADD CONSTRAINT "QuotationPayment_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationPayment" ADD CONSTRAINT "QuotationPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationInstallment" ADD CONSTRAINT "QuotationInstallment_quotationPaymentId_fkey" FOREIGN KEY ("quotationPaymentId") REFERENCES "QuotationPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationInstallment" ADD CONSTRAINT "QuotationInstallment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
