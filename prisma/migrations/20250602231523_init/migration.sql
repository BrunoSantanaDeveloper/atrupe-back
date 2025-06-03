-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('COMPANY', 'EMPLOYEE', 'CLIENT', 'SUPPLIER', 'CONTACT');

-- CreateEnum
CREATE TYPE "SectorKind" AS ENUM ('ADMINISTRATIVE', 'OPERATIONAL', 'FINANCIAL', 'COMMERCIAL', 'MARKETING', 'IT', 'HUMAN_RESOURCES', 'LEGAL', 'PRODUCTION', 'LOGISTICS', 'QUALITY', 'SECURITY', 'MAINTENANCE', 'CLEANING', 'SYSTEM', 'OTHER');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('PRODUCT', 'SERVICE', 'CLIENT', 'SUPPLIER', 'PAYABLE', 'PAYABLE_ORIGIN', 'RECEIVABLE', 'RECEIVABLE_ORIGIN');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROVISIONED', 'PAID', 'OVERDUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "FinancialFlowType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "SheetStatus" AS ENUM ('EMPTY', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('INCREASE', 'DISCOUNT', 'ADVANCE');

-- CreateEnum
CREATE TYPE "PaymentSalaryStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'OUTCOME', 'TRANSFER_INCOME', 'TRANSFER_OUTCOME');

-- CreateEnum
CREATE TYPE "CashRegisterStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BankAccountCashControlType" AS ENUM ('PAYSOFF', 'PROVISION');

-- CreateEnum
CREATE TYPE "PaymentConditionCostType" AS ENUM ('PERCENT', 'VALUE');

-- CreateEnum
CREATE TYPE "BiilingKind" AS ENUM ('ON_ORDER', 'ON_DELIVERY', 'ON_CHECKOUT', 'NO_INVOICE');

-- CreateEnum
CREATE TYPE "SendToProductionKind" AS ENUM ('DIRECT');

-- CreateEnum
CREATE TYPE "ProductionStatusKind" AS ENUM ('MANAGE_PRODUCTION', 'PRODUCTION_COMPLETED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('APPROVED', 'OPEN', 'DONE', 'CLOSED', 'CANCELED', 'REJECTED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('NFE', 'NFSE', 'OTHER');

-- CreateEnum
CREATE TYPE "transferMethodCommission" AS ENUM ('SINGLE', 'PAYMENT_BASED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('ADD', 'SUB');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'IN_PRODUCTION', 'DELIVERY', 'COMPLETED', 'FINISHED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('INSTALLATION', 'CARRIER', 'PICKUP');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UnitOfMeasureKind" AS ENUM ('LENGTH', 'WEIGHT', 'CAPACITY');

-- CreateEnum
CREATE TYPE "ReasonType" AS ENUM ('REJECTION', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "DeliveryScheduleStatus" AS ENUM ('IN_PRODUCTION', 'DELIVERING', 'FINISHED', 'DONE');

-- CreateEnum
CREATE TYPE "ProductionStageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'PENDING', 'DONE', 'CANCELED', 'WAITING_PRODUCTION', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('START', 'LITE', 'PRO', 'ELITE', 'FULL');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('CREDIT_CARD', 'BOLETO', 'PIX');

-- CreateEnum
CREATE TYPE "Cycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('SUCCESS', 'PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "cnpj" TEXT,
    "stateRegistration" TEXT,
    "municipalRegistration" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "siteUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "principalCompanyId" TEXT,
    "logoUrl" TEXT,
    "favIconUrl" TEXT,
    "textBeforeItems" TEXT,
    "textAfterItems" TEXT,
    "deliveryType" "DeliveryType"[],

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Principal',
    "street" TEXT,
    "number" TEXT,
    "neighborhood" TEXT,
    "country" TEXT,
    "zipcode" TEXT,
    "complement" TEXT,
    "city" TEXT,
    "state" TEXT,
    "ownerType" "OwnerType" NOT NULL DEFAULT 'COMPANY',
    "companyId" TEXT,
    "ownerId" TEXT,
    "supplierId" TEXT,
    "employeeId" TEXT,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "default_sectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "kind" "SectorKind" NOT NULL DEFAULT 'PRODUCTION',

    CONSTRAINT "default_sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "kind" "SectorKind" NOT NULL DEFAULT 'PRODUCTION',
    "isProductionStage" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT NOT NULL,
    "defaultSectorId" TEXT,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT NOT NULL,
    "sectorId" TEXT,
    "permissions" TEXT[],

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "commission" DOUBLE PRECISION,
    "maxDiscount" DOUBLE PRECISION,
    "minValue" DOUBLE PRECISION,
    "canApprovePreRegistration" BOOLEAN NOT NULL DEFAULT false,
    "canCancelSale" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "seller_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL DEFAULT 'PRODUCT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isStandard" BOOLEAN NOT NULL DEFAULT false,
    "sectorId" TEXT,
    "companyId" TEXT,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "sector" TEXT,
    "notes" TEXT,
    "clientId" TEXT,
    "supplierId" TEXT,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_limit_default" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "type" "ClientKind" NOT NULL DEFAULT 'PERSON',
    "companyId" TEXT NOT NULL,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,

    CONSTRAINT "credit_limit_default_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_limit_payment_conditions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creditLimitDefaultId" TEXT NOT NULL,
    "paymentConditionId" TEXT NOT NULL,

    CONSTRAINT "credit_limit_payment_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "type" "ClientKind" NOT NULL DEFAULT 'PERSON',
    "status" "ClientStatus" NOT NULL DEFAULT 'PROSPECT',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "rg" TEXT,
    "cpf" TEXT,
    "cnpj" TEXT,
    "activity" TEXT,
    "tradeName" TEXT,
    "corporateName" TEXT,
    "notes" TEXT,
    "financialNotes" TEXT,
    "nickname" TEXT,
    "site" TEXT,
    "birthdate" TIMESTAMP(3),
    "responsibleId" TEXT,
    "companyId" TEXT NOT NULL,
    "category" TEXT,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "blockClient" BOOLEAN NOT NULL DEFAULT false,
    "supplierId" TEXT,
    "planId" TEXT,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "type" "ClientKind" NOT NULL DEFAULT 'PERSON',
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "rg" TEXT,
    "cpf" TEXT,
    "cnpj" TEXT,
    "activity" TEXT,
    "tradeName" TEXT,
    "corporateName" TEXT,
    "notes" TEXT,
    "financialNotes" TEXT,
    "nickname" TEXT,
    "site" TEXT,
    "birthdate" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "category" TEXT,
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "blockClient" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT,
    "avatarUrl" TEXT,
    "cpf" TEXT,
    "rg" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "sallary" DOUBLE PRECISION,
    "signatureUrl" TEXT,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "roleId" TEXT,
    "sectorId" TEXT,
    "sellerProfileId" TEXT,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatar" TEXT,
    "phone" TEXT,
    "resetPasswordToken" TEXT,
    "resetPasswordExpires" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_verifications" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "email" TEXT NOT NULL,
    "token" TEXT,
    "expiresAt" TIMESTAMP(3),
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "mail_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "purchaseValue" DOUBLE PRECISION NOT NULL,
    "residualValue" DOUBLE PRECISION NOT NULL,
    "usefulLife" INTEGER NOT NULL,
    "costGroupId" INTEGER,
    "fixedMonthlyCost" DOUBLE PRECISION,
    "variableTotalMonthlyCost" DOUBLE PRECISION,
    "variableQualityMonthlyCost" DOUBLE PRECISION,
    "companyId" TEXT,
    "typeId" TEXT,
    "sectorId" TEXT,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_types" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "details" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isStandard" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT,

    CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "totalValue" DOUBLE PRECISION,
    "mainAdditionalFee" DOUBLE PRECISION,
    "natureId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DOUBLE PRECISION,
    "installmentQty" INTEGER,
    "cancelReason" TEXT,
    "cancelNotes" TEXT,
    "changeReason" TEXT,
    "changeNotes" TEXT,
    "clientId" TEXT,
    "supplierId" TEXT,
    "subCategoryId" TEXT,
    "companyId" TEXT NOT NULL,
    "quotationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_installments" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION,
    "paymentMethodId" TEXT,
    "additionalFee" DOUBLE PRECISION,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidDate" TIMESTAMP(3),
    "provisionDate" TIMESTAMP(3),
    "bankAccountId" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "receivable_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_history" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receivable_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payables" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "totalValue" DOUBLE PRECISION,
    "mainAdditionalFee" DOUBLE PRECISION,
    "natureId" TEXT,
    "subCategoryId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "installmentQty" INTEGER,
    "cancelReason" TEXT,
    "cancelNotes" TEXT,
    "changeReason" TEXT,
    "changeNotes" TEXT,
    "supplierId" TEXT,
    "clientId" TEXT,
    "companyId" TEXT NOT NULL,
    "quotationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_installments" (
    "id" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION,
    "paymentMethodId" TEXT,
    "additionalFee" DOUBLE PRECISION,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provisionDate" TIMESTAMP(3),
    "paidDate" TIMESTAMP(3),
    "bankAccountId" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "payable_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_history" (
    "id" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payable_history_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "salary_controls" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "type" "ItemType" NOT NULL DEFAULT 'INCREASE',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "salary_controls_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "financial_flows" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "FinancialFlowType" NOT NULL,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "description" TEXT,
    "status" "CashRegisterStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "openingDate" TIMESTAMP(3) NOT NULL,
    "closingDate" TIMESTAMP(3),
    "openingBalance" DOUBLE PRECISION NOT NULL,
    "totalIncomes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalOutcomes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retroactive" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closingBalance" DOUBLE PRECISION,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "type" "TransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "cashRegisterId" TEXT NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_expenses" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "attributes" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "code" TEXT NOT NULL,
    "details" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "cashControl" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_account_cash_controls" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "acceptPayments" BOOLEAN NOT NULL DEFAULT true,
    "paymentType" "BankAccountCashControlType" NOT NULL DEFAULT 'PAYSOFF',
    "acceptIncomes" BOOLEAN NOT NULL DEFAULT true,
    "incomeType" "BankAccountCashControlType" NOT NULL DEFAULT 'PAYSOFF',
    "acceptMultipleCashRegisters" BOOLEAN NOT NULL DEFAULT false,
    "paymentMethodId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "cashRegisterId" TEXT,

    CONSTRAINT "bank_account_cash_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_conditions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "acceptInstallments" BOOLEAN NOT NULL DEFAULT false,
    "costType" "PaymentConditionCostType" NOT NULL,
    "minInstallments" INTEGER,
    "maxInstallments" INTEGER,
    "receivingType" TEXT,
    "dayInterval" INTEGER,
    "paymentMethodId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "payment_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" TEXT NOT NULL,
    "installment" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "operatorFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "operatorFeeTransfer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentConditionId" TEXT NOT NULL,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_configurations" (
    "id" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "paymentConditionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_series" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isTraining" BOOLEAN NOT NULL DEFAULT false,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "title" TEXT NOT NULL,
    "currentBudgetNumber" INTEGER NOT NULL DEFAULT 0,
    "proposalValidity" INTEGER,
    "deliveryDeadline" INTEGER,
    "billing" "BiilingKind" NOT NULL DEFAULT 'ON_ORDER',
    "sendToProduction" "SendToProductionKind" NOT NULL DEFAULT 'DIRECT',
    "productionStatus" "ProductionStatusKind" NOT NULL DEFAULT 'MANAGE_PRODUCTION',
    "textBeforeItems" TEXT,
    "textAfterItems" TEXT,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "sale_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_quotation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "status_quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "quotationNumber" INTEGER,
    "description" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactType" TEXT,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellerId" TEXT NOT NULL,
    "seriesId" TEXT,
    "clientId" TEXT,
    "companyId" TEXT NOT NULL,
    "subCompanyId" TEXT,
    "tagId" TEXT,
    "quickSale" BOOLEAN NOT NULL DEFAULT false,
    "reasonId" TEXT,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_products" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "technicalDescription" TEXT,
    "imageUrl" TEXT,
    "totalValue" DOUBLE PRECISION,
    "notes" TEXT,
    "discount" DOUBLE PRECISION,
    "discountType" TEXT,
    "finalValue" DOUBLE PRECISION,
    "allowEditDescription" BOOLEAN NOT NULL DEFAULT true,
    "allowEditValues" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "quotation_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_product_items" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quotationProductId" TEXT NOT NULL,
    "productItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "originalQuantity" INTEGER NOT NULL DEFAULT 1,
    "unitOfMeasureId" TEXT NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "distance" DOUBLE PRECISION,
    "duration" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "salePrice" DOUBLE PRECISION,
    "totalValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "quotation_product_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_payments" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'OTHER',
    "billing" "BiilingKind" NOT NULL DEFAULT 'ON_ORDER',
    "discountType" TEXT NOT NULL DEFAULT 'VALUE',
    "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downPayment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downPaymentConditionId" TEXT,
    "downPaymentAdditionalFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "downPaymentDueDate" TIMESTAMP(3),
    "paymentMethodId" TEXT,
    "paymentConditionId" TEXT,
    "commissionId" TEXT,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "finalValue" DOUBLE PRECISION,
    "installmentQty" INTEGER,
    "minInstallmentQty" INTEGER,
    "maxInstallmentQty" INTEGER,
    "mainAdditionalFee" DOUBLE PRECISION,
    "additionalFeeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "quotation_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "type" "CommissionType" NOT NULL DEFAULT 'ADD',
    "supplierId" TEXT NOT NULL,
    "transferMethod" "transferMethodCommission" NOT NULL DEFAULT 'SINGLE',
    "commissionValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionType" TEXT NOT NULL DEFAULT 'VALUE',
    "totalCommission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receivableId" TEXT,
    "payableId" TEXT,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_installments" (
    "id" TEXT NOT NULL,
    "quotationPaymentId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "additionalFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "payableInstallmentId" TEXT,
    "receivableInstallmentId" TEXT,

    CONSTRAINT "quotation_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_info" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "deliveryType" "DeliveryType" NOT NULL DEFAULT 'PICKUP',
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
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "quotationId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'IN_PRODUCTION',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reasonId" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "isStandard" BOOLEAN NOT NULL DEFAULT false,
    "technicalDescription" TEXT,
    "allowEditValues" BOOLEAN NOT NULL DEFAULT true,
    "allowEditDescription" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "productionStages" JSONB,
    "companyId" TEXT,
    "categoryId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitOfMeasureId" TEXT NOT NULL,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "distance" DOUBLE PRECISION,
    "duration" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "salePrice" DOUBLE PRECISION,

    CONSTRAINT "product_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_measures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "UnitOfMeasureKind",
    "description" TEXT,
    "companyId" TEXT NOT NULL,
    "defaultUnitOfMeasureId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unit_measures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defalt_unit_measures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "UnitOfMeasureKind",
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "defalt_unit_measures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "languages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reasons" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "type" "ReasonType" NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "reasons_pkey" PRIMARY KEY ("id")
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
    "description" TEXT,
    "level1" TEXT,
    "level2" TEXT,
    "code" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "natures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_categories" (
    "id" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT,
    "companyId" TEXT NOT NULL,
    "natureId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sub_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_payment_conditions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clientId" TEXT NOT NULL,
    "paymentConditionId" TEXT NOT NULL,

    CONSTRAINT "client_payment_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_conditions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "supplierId" TEXT NOT NULL,
    "paymentConditionId" TEXT NOT NULL,

    CONSTRAINT "supplier_payment_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "type" "PlanType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isContractAccepted" BOOLEAN NOT NULL DEFAULT false,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "billingType" "BillingType" NOT NULL DEFAULT 'CREDIT_CARD',
    "planPrice" DOUBLE PRECISION NOT NULL,
    "cycle" "Cycle" NOT NULL DEFAULT 'MONTHLY',
    "name" TEXT,
    "cpfCnpj" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobilePhone" TEXT,
    "address" TEXT,
    "addressNumber" TEXT,
    "complement" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "neighborhood" TEXT,
    "planId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentUrl" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_contracts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "user_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_QuotationToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "addresses_ownerId_ownerType_idx" ON "addresses"("ownerId", "ownerType");

-- CreateIndex
CREATE INDEX "addresses_supplierId_ownerType_idx" ON "addresses"("supplierId", "ownerType");

-- CreateIndex
CREATE UNIQUE INDEX "credit_limit_payment_conditions_creditLimitDefaultId_paymen_key" ON "credit_limit_payment_conditions"("creditLimitDefaultId", "paymentConditionId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "mail_verifications_email_key" ON "mail_verifications"("email");

-- CreateIndex
CREATE UNIQUE INDEX "salary_sheets_employeeId_month_year_key" ON "salary_sheets"("employeeId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_companyId_key" ON "invoices"("number", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_series_code_companyId_key" ON "sale_series"("code", "companyId");

-- CreateIndex
CREATE INDEX "quotations_id_companyId_idx" ON "quotations"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_payments_quotationId_key" ON "quotation_payments"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_payments_commissionId_key" ON "quotation_payments"("commissionId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_info_quotationId_key" ON "delivery_info"("quotationId");

-- CreateIndex
CREATE INDEX "delivery_info_quotationId_idx" ON "delivery_info"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_quotationId_key" ON "orders"("quotationId");

-- CreateIndex
CREATE INDEX "orders_id_idx" ON "orders"("id");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_companyId_key" ON "products"("code", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "defalt_unit_measures_code_key" ON "defalt_unit_measures"("code");

-- CreateIndex
CREATE UNIQUE INDEX "languages_code_key" ON "languages"("code");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_schedules_quotationId_key" ON "delivery_schedules"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_schedules_deliveryInfoId_key" ON "delivery_schedules"("deliveryInfoId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_schedules_orderId_key" ON "delivery_schedules"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "client_payment_conditions_clientId_paymentConditionId_key" ON "client_payment_conditions"("clientId", "paymentConditionId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_conditions_supplierId_paymentConditionId_key" ON "supplier_payment_conditions"("supplierId", "paymentConditionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_contracts_userId_contractId_key" ON "user_contracts"("userId", "contractId");

-- CreateIndex
CREATE UNIQUE INDEX "_QuotationToProduct_AB_unique" ON "_QuotationToProduct"("A", "B");

-- CreateIndex
CREATE INDEX "_QuotationToProduct_B_index" ON "_QuotationToProduct"("B");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_principalCompanyId_fkey" FOREIGN KEY ("principalCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_defaultSectorId_fkey" FOREIGN KEY ("defaultSectorId") REFERENCES "default_sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_profile" ADD CONSTRAINT "seller_profile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limit_default" ADD CONSTRAINT "credit_limit_default_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limit_payment_conditions" ADD CONSTRAINT "credit_limit_payment_conditions_creditLimitDefaultId_fkey" FOREIGN KEY ("creditLimitDefaultId") REFERENCES "credit_limit_default"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limit_payment_conditions" ADD CONSTRAINT "credit_limit_payment_conditions_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "seller_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "asset_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_types" ADD CONSTRAINT "asset_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_history" ADD CONSTRAINT "receivable_history_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_history" ADD CONSTRAINT "payable_history_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_sheets" ADD CONSTRAINT "salary_sheets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_sheets" ADD CONSTRAINT "salary_sheets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_items" ADD CONSTRAINT "salary_items_salarySheetId_fkey" FOREIGN KEY ("salarySheetId") REFERENCES "salary_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_controls" ADD CONSTRAINT "salary_controls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_controls" ADD CONSTRAINT "salary_controls_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_salarySheetId_fkey" FOREIGN KEY ("salarySheetId") REFERENCES "salary_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_movements" ADD CONSTRAINT "payment_movements_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_flows" ADD CONSTRAINT "financial_flows_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_cash_controls" ADD CONSTRAINT "bank_account_cash_controls_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_cash_controls" ADD CONSTRAINT "bank_account_cash_controls_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_cash_controls" ADD CONSTRAINT "bank_account_cash_controls_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_conditions" ADD CONSTRAINT "payment_conditions_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_conditions" ADD CONSTRAINT "payment_conditions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configurations" ADD CONSTRAINT "payment_configurations_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configurations" ADD CONSTRAINT "payment_configurations_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configurations" ADD CONSTRAINT "payment_configurations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_series" ADD CONSTRAINT "sale_series_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_quotation" ADD CONSTRAINT "status_quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_subCompanyId_fkey" FOREIGN KEY ("subCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "sale_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "status_quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_quotationProductId_fkey" FOREIGN KEY ("quotationProductId") REFERENCES "quotation_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "product_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_unitOfMeasureId_fkey" FOREIGN KEY ("unitOfMeasureId") REFERENCES "unit_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_downPaymentConditionId_fkey" FOREIGN KEY ("downPaymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_quotationPaymentId_fkey" FOREIGN KEY ("quotationPaymentId") REFERENCES "quotation_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_payableInstallmentId_fkey" FOREIGN KEY ("payableInstallmentId") REFERENCES "payable_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_receivableInstallmentId_fkey" FOREIGN KEY ("receivableInstallmentId") REFERENCES "receivable_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_info" ADD CONSTRAINT "delivery_info_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_info" ADD CONSTRAINT "delivery_info_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_unitOfMeasureId_fkey" FOREIGN KEY ("unitOfMeasureId") REFERENCES "unit_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_measures" ADD CONSTRAINT "unit_measures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_measures" ADD CONSTRAINT "unit_measures_defaultUnitOfMeasureId_fkey" FOREIGN KEY ("defaultUnitOfMeasureId") REFERENCES "defalt_unit_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "languages" ADD CONSTRAINT "languages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reasons" ADD CONSTRAINT "reasons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "natures" ADD CONSTRAINT "natures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "natures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_payment_conditions" ADD CONSTRAINT "client_payment_conditions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_payment_conditions" ADD CONSTRAINT "client_payment_conditions_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_conditions" ADD CONSTRAINT "supplier_payment_conditions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_conditions" ADD CONSTRAINT "supplier_payment_conditions_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contracts" ADD CONSTRAINT "user_contracts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contracts" ADD CONSTRAINT "user_contracts_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuotationToProduct" ADD CONSTRAINT "_QuotationToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuotationToProduct" ADD CONSTRAINT "_QuotationToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
