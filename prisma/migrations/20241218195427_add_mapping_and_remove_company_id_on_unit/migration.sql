/*
  Warnings:

  - You are about to drop the column `companyId` on the `unit_measures` table. All the data in the column will be lost.
  - You are about to drop the `Commission` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DeliveryInfo` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DeliverySchedule` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DeliveryType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Nature` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PaymentMovement` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProductionStage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuotationInstallment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `QuotationPayment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalaryItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalarySheet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SubCategory` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Commission" DROP CONSTRAINT "Commission_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryInfo" DROP CONSTRAINT "DeliveryInfo_deliveryTypeId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryInfo" DROP CONSTRAINT "DeliveryInfo_quotationId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryInfo" DROP CONSTRAINT "DeliveryInfo_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "DeliverySchedule" DROP CONSTRAINT "DeliverySchedule_companyId_fkey";

-- DropForeignKey
ALTER TABLE "DeliverySchedule" DROP CONSTRAINT "DeliverySchedule_deliveryInfoId_fkey";

-- DropForeignKey
ALTER TABLE "DeliverySchedule" DROP CONSTRAINT "DeliverySchedule_orderId_fkey";

-- DropForeignKey
ALTER TABLE "DeliverySchedule" DROP CONSTRAINT "DeliverySchedule_quotationId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryType" DROP CONSTRAINT "DeliveryType_companyId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentMovement" DROP CONSTRAINT "PaymentMovement_paymentMethodId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentMovement" DROP CONSTRAINT "PaymentMovement_salarySheetId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionStage" DROP CONSTRAINT "ProductionStage_scheduleId_fkey";

-- DropForeignKey
ALTER TABLE "ProductionStage" DROP CONSTRAINT "ProductionStage_stageId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationInstallment" DROP CONSTRAINT "QuotationInstallment_paymentMethodId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationInstallment" DROP CONSTRAINT "QuotationInstallment_quotationPaymentId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationPayment" DROP CONSTRAINT "QuotationPayment_commissionId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationPayment" DROP CONSTRAINT "QuotationPayment_paymentConditionId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationPayment" DROP CONSTRAINT "QuotationPayment_paymentMethodId_fkey";

-- DropForeignKey
ALTER TABLE "QuotationPayment" DROP CONSTRAINT "QuotationPayment_quotationId_fkey";

-- DropForeignKey
ALTER TABLE "SalaryItem" DROP CONSTRAINT "SalaryItem_salarySheetId_fkey";

-- DropForeignKey
ALTER TABLE "SalarySheet" DROP CONSTRAINT "SalarySheet_companyId_fkey";

-- DropForeignKey
ALTER TABLE "SalarySheet" DROP CONSTRAINT "SalarySheet_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "SubCategory" DROP CONSTRAINT "SubCategory_natureId_fkey";

-- DropForeignKey
ALTER TABLE "installments" DROP CONSTRAINT "installments_quotationPaymentId_fkey";

-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_natureId_fkey";

-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_subCategoryId_fkey";

-- DropForeignKey
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_natureId_fkey";

-- DropForeignKey
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_subCategoryId_fkey";

-- DropForeignKey
ALTER TABLE "unit_measures" DROP CONSTRAINT "unit_measures_companyId_fkey";

-- AlterTable
ALTER TABLE "unit_measures" DROP COLUMN "companyId";

-- DropTable
DROP TABLE "Commission";

-- DropTable
DROP TABLE "DeliveryInfo";

-- DropTable
DROP TABLE "DeliverySchedule";

-- DropTable
DROP TABLE "DeliveryType";

-- DropTable
DROP TABLE "Nature";

-- DropTable
DROP TABLE "PaymentMovement";

-- DropTable
DROP TABLE "ProductionStage";

-- DropTable
DROP TABLE "QuotationInstallment";

-- DropTable
DROP TABLE "QuotationPayment";

-- DropTable
DROP TABLE "SalaryItem";

-- DropTable
DROP TABLE "SalarySheet";

-- DropTable
DROP TABLE "SubCategory";

-- CreateTable
CREATE TABLE "salary_sheets" (
    "id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "SheetStatus" NOT NULL DEFAULT 'EMPTY',
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "salary_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_items" (
    "id" TEXT NOT NULL,
    "salarySheetId" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_movements" (
    "id" TEXT NOT NULL,
    "salarySheetId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidDate" TIMESTAMP(3) NOT NULL,
    "paymentStatus" "PaymentSalaryStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethodId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_payments" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "billing" TEXT,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downPayment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentMethodId" TEXT,
    "paymentConditionId" TEXT,
    "commissionId" TEXT,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "finalValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "quotation_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "type" "CommissionType" NOT NULL DEFAULT 'ADD',
    "transferMethod" "transferMethodCommission" NOT NULL DEFAULT 'SINGLE',
    "commissionValue" DOUBLE PRECISION,
    "totalCommission" DOUBLE PRECISION,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_installments" (
    "id" TEXT NOT NULL,
    "quotationPaymentId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "surcharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_info" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "deliveryTypeId" TEXT,
    "daysAfterApproval" INTEGER,
    "estimatedDate" TIMESTAMP(3),
    "modality" TEXT NOT NULL DEFAULT 'Indefinida',
    "cost" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "notes" TEXT,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "delivery_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCarrier" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,

    CONSTRAINT "delivery_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_schedules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "quotationId" TEXT,
    "deliveryInfoId" TEXT,
    "orderId" TEXT,
    "status" "DeliveryScheduleStatus" NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "addScheduleTime" BOOLEAN NOT NULL DEFAULT false,
    "pendingDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "delivery_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_stages" (
    "id" TEXT NOT NULL,
    "stageId" TEXT,
    "status" "ProductionStageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "notes" TEXT,
    "order" INTEGER,
    "prevStatus" TEXT,
    "scheduleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "production_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "natures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "natures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "natureId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sub_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_sheets_employeeId_month_year_key" ON "salary_sheets"("employeeId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_payments_quotationId_key" ON "quotation_payments"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_payments_commissionId_key" ON "quotation_payments"("commissionId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_info_quotationId_key" ON "delivery_info"("quotationId");

-- CreateIndex
CREATE INDEX "delivery_info_quotationId_idx" ON "delivery_info"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_schedules_quotationId_key" ON "delivery_schedules"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_schedules_deliveryInfoId_key" ON "delivery_schedules"("deliveryInfoId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_schedules_orderId_key" ON "delivery_schedules"("orderId");

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_sheets" ADD CONSTRAINT "salary_sheets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_sheets" ADD CONSTRAINT "salary_sheets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_items" ADD CONSTRAINT "salary_items_salarySheetId_fkey" FOREIGN KEY ("salarySheetId") REFERENCES "salary_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_salarySheetId_fkey" FOREIGN KEY ("salarySheetId") REFERENCES "salary_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_quotationPaymentId_fkey" FOREIGN KEY ("quotationPaymentId") REFERENCES "quotation_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_quotationPaymentId_fkey" FOREIGN KEY ("quotationPaymentId") REFERENCES "quotation_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_info" ADD CONSTRAINT "delivery_info_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_info" ADD CONSTRAINT "delivery_info_deliveryTypeId_fkey" FOREIGN KEY ("deliveryTypeId") REFERENCES "delivery_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_info" ADD CONSTRAINT "delivery_info_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_types" ADD CONSTRAINT "delivery_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_deliveryInfoId_fkey" FOREIGN KEY ("deliveryInfoId") REFERENCES "delivery_info"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "delivery_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "natures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
