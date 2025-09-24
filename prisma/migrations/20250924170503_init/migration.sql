-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('COMPANY', 'EMPLOYEE', 'CLIENT', 'SUPPLIER', 'CONTACT');

-- CreateEnum
CREATE TYPE "SectorKind" AS ENUM ('ADMINISTRATIVE', 'OPERATIONAL', 'FINANCIAL', 'COMMERCIAL', 'MARKETING', 'IT', 'HUMAN_RESOURCES', 'LEGAL', 'PRODUCTION', 'LOGISTICS', 'QUALITY', 'SECURITY', 'MAINTENANCE', 'CLEANING', 'OTHER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('PRODUCT', 'SERVICE', 'CLIENT', 'SUPPLIER', 'PAYABLE', 'RECEIVABLE', 'PAYABLE_ORIGIN', 'RECEIVABLE_ORIGIN');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED', 'PROVISIONED');

-- CreateEnum
CREATE TYPE "FinancialFlowType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "SheetStatus" AS ENUM ('OPEN', 'CLOSED', 'EMPTY');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('INCREASE', 'DISCOUNT', 'ADVANCE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'OUTCOME', 'TRANSFER_INCOME', 'TRANSFER_OUTCOME');

-- CreateEnum
CREATE TYPE "CashRegisterStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RecurringType" AS ENUM ('WEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY', 'ONCE', 'BIWEEKLY');

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
CREATE TYPE "QuotationStatus" AS ENUM ('APPROVED', 'OPEN', 'CLOSED', 'CANCELED', 'REJECTED', 'DONE');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('NFE', 'NFSE', 'OTHER');

-- CreateEnum
CREATE TYPE "transferMethodCommission" AS ENUM ('SINGLE', 'PAYMENT_BASED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('ADD', 'SUB');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('IN_PRODUCTION', 'DELIVERY', 'COMPLETED', 'CANCELED', 'FINISHED', 'PENDING');

-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('INSTALLATION', 'CARRIER', 'PICKUP');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ReasonType" AS ENUM ('REJECTION', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "DeliveryScheduleStatus" AS ENUM ('IN_PRODUCTION', 'DELIVERING', 'DONE', 'FINISHED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProductionStageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'PENDING', 'DONE', 'CANCELED', 'WAITING_PRODUCTION');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('START', 'LITE', 'PRO', 'ELITE', 'FULL', 'TRIAL');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('CREDIT_CARD', 'BOLETO', 'PIX', 'DEBIT_CARD', 'TRANSFER', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "Cycle" AS ENUM ('MONTHLY', 'YEARLY', 'WEEKLY', 'BIWEEKLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('LENGTH', 'WEIGHT', 'CAPACITY', 'DISTANCE', 'DURATION', 'UNITY', 'AREA');

-- CreateEnum
CREATE TYPE "FinancialType" AS ENUM ('MAIN', 'DOWN_PAYMENT', 'COMMISSION', 'DELIVERY', 'ADVANCE');

-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('SUPPLIER', 'EMPLOYEE', 'CLIENT', 'OTHER');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3),
    "cnpj" TEXT,
    "legalName" TEXT,
    "municipalRegistration" TEXT,
    "stateRegistration" TEXT,
    "email" TEXT,
    "favIconUrl" TEXT,
    "logoUrl" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "siteUrl" TEXT,
    "textAfterItems" TEXT,
    "textBeforeItems" TEXT,
    "principalCompanyId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "facebook" TEXT,
    "instagram" TEXT,
    "linkedin" TEXT,
    "unitDefaults" JSONB,
    "deliveryType" "DeliveryType"[],

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "street" TEXT,
    "number" TEXT,
    "country" TEXT,
    "ownerId" TEXT,
    "ownerType" "OwnerType" NOT NULL DEFAULT 'COMPANY',
    "complement" TEXT,
    "neighborhood" TEXT,
    "zipcode" TEXT,
    "city" TEXT,
    "state" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Principal',
    "supplierId" TEXT,
    "companyId" TEXT,
    "employeeId" TEXT,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "companyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "kind" "SectorKind" NOT NULL DEFAULT 'PRODUCTION',
    "isProductionStage" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sectorId" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
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
    "companyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isStandard" BOOLEAN NOT NULL DEFAULT false,
    "sectorId" TEXT,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "email" TEXT,
    "sector" TEXT,
    "clientId" TEXT,
    "supplierId" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "notes" TEXT,

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
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'PROSPECT',
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "responsibleId" TEXT,
    "birthdate" TIMESTAMP(3),
    "financialNotes" TEXT,
    "nickname" TEXT,
    "notes" TEXT,
    "site" TEXT,
    "activity" TEXT,
    "cnpj" TEXT,
    "corporateName" TEXT,
    "cpf" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "rg" TEXT,
    "tradeName" TEXT,
    "type" "ClientKind" NOT NULL DEFAULT 'PERSON',
    "category" TEXT,
    "categoryId" TEXT,
    "blockClient" BOOLEAN NOT NULL DEFAULT false,
    "maxValue" DOUBLE PRECISION,
    "minValue" DOUBLE PRECISION,
    "supplierId" TEXT,
    "planId" TEXT,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "updatedAt" TIMESTAMP(3),
    "birthdate" TIMESTAMP(3),
    "financialNotes" TEXT,
    "nickname" TEXT,
    "notes" TEXT,
    "site" TEXT,
    "activity" TEXT,
    "cnpj" TEXT,
    "corporateName" TEXT,
    "cpf" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "rg" TEXT,
    "tradeName" TEXT,
    "type" "ClientKind" NOT NULL DEFAULT 'PERSON',
    "blockClient" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "categoryId" TEXT,
    "maxValue" DOUBLE PRECISION,
    "minValue" DOUBLE PRECISION,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT,
    "sectorId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sallary" DOUBLE PRECISION,
    "sellerProfileId" TEXT,
    "name" TEXT,
    "avatarUrl" TEXT,
    "cpf" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "rg" TEXT,
    "signatureUrl" TEXT,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "avatar" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "resetPasswordExpires" TIMESTAMP(3),
    "resetPasswordToken" TEXT,
    "phone" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "customerId" TEXT,

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
    "name" TEXT NOT NULL,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fixedMonthlyCost" DOUBLE PRECISION,
    "purchaseValue" DOUBLE PRECISION NOT NULL,
    "residualValue" DOUBLE PRECISION NOT NULL,
    "sectorId" TEXT,
    "typeId" TEXT,
    "updatedAt" TIMESTAMP(3),
    "usefulLife" INTEGER NOT NULL,
    "variableQualityMonthlyCost" DOUBLE PRECISION,
    "variableTotalMonthlyCost" DOUBLE PRECISION,

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
    "companyId" TEXT,
    "isStandard" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "description" TEXT,
    "reference" TEXT,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "subCategoryId" TEXT,
    "installmentQty" INTEGER,
    "totalAmount" DOUBLE PRECISION,
    "cancelReason" TEXT,
    "natureId" TEXT,
    "notes" TEXT,
    "totalValue" DOUBLE PRECISION,
    "cancelNotes" TEXT,
    "changeNotes" TEXT,
    "changeReason" TEXT,
    "updatedAt" TIMESTAMP(3),
    "quotationId" TEXT,
    "supplierId" TEXT,
    "mainAdditionalFee" DOUBLE PRECISION,
    "financialType" "FinancialType" NOT NULL DEFAULT 'MAIN',

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_installments" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethodId" TEXT,
    "additionalFee" DOUBLE PRECISION,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "bankAccountId" TEXT,
    "paidAmount" DOUBLE PRECISION,
    "transactionId" TEXT,
    "provisionDate" TIMESTAMP(3),

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
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "reference" TEXT,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "subCategoryId" TEXT,
    "installmentQty" INTEGER,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "cancelReason" TEXT,
    "natureId" TEXT,
    "supplierId" TEXT,
    "notes" TEXT,
    "cancelNotes" TEXT,
    "changeNotes" TEXT,
    "changeReason" TEXT,
    "updatedAt" TIMESTAMP(3),
    "quotationId" TEXT,
    "clientId" TEXT,
    "employeeId" TEXT,
    "mainAdditionalFee" DOUBLE PRECISION,
    "totalValue" DOUBLE PRECISION,
    "scheduledExpenseId" TEXT,
    "financialType" "FinancialType" NOT NULL DEFAULT 'MAIN',
    "expenseSource" "ExpenseSource" NOT NULL DEFAULT 'SUPPLIER',

    CONSTRAINT "payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_installments" (
    "id" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethodId" TEXT,
    "additionalFee" DOUBLE PRECISION,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "bankAccountId" TEXT,
    "paidAmount" DOUBLE PRECISION,
    "transactionId" TEXT,
    "provisionDate" TIMESTAMP(3),

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
CREATE TABLE "payroll" (
    "id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "SheetStatus" NOT NULL DEFAULT 'EMPTY',
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_setup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "type" "ItemType" NOT NULL DEFAULT 'INCREASE',
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isSet" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payroll_setup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ItemType" NOT NULL DEFAULT 'INCREASE',
    "defaultAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_flow" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "FinancialFlowType" NOT NULL,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "status" "CashRegisterStatus" NOT NULL DEFAULT 'OPEN',
    "openingDate" TIMESTAMP(3) NOT NULL,
    "closingDate" TIMESTAMP(3),
    "openingBalance" DOUBLE PRECISION NOT NULL,
    "totalIncomes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalOutcomes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retroactive" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closingBalance" DOUBLE PRECISION,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,

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
    "cashRegisterId" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_expenses" (
    "id" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoryId" TEXT,
    "dueDay" INTEGER NOT NULL DEFAULT 1,
    "recurringType" "RecurringType" NOT NULL DEFAULT 'MONTHLY',
    "subCategoryId" TEXT,
    "supplierId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

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
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "details" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "icon" TEXT,

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
    "companyId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "cashControl" BOOLEAN NOT NULL DEFAULT false,

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
    "paymentMethodId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "cashRegisterId" TEXT,
    "acceptMultipleCashRegisters" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bank_account_cash_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_conditions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acceptInstallments" BOOLEAN NOT NULL DEFAULT false,
    "costType" "PaymentConditionCostType" NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxInstallments" INTEGER,
    "minInstallments" INTEGER,
    "paymentMethodId" TEXT NOT NULL,
    "dayInterval" INTEGER,
    "receivingType" TEXT,

    CONSTRAINT "payment_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" TEXT NOT NULL,
    "installment" INTEGER NOT NULL,
    "operatorFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "operatorFeeTransfer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentConditionId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),

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
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "currentBudgetNumber" INTEGER NOT NULL DEFAULT 0,
    "deliveryDeadline" INTEGER,
    "description" TEXT,
    "proposalValidity" INTEGER,
    "textAfterItems" TEXT,
    "textBeforeItems" TEXT,
    "title" TEXT NOT NULL,
    "billing" "BiilingKind" NOT NULL DEFAULT 'ON_ORDER',
    "productionStatus" "ProductionStatusKind" NOT NULL DEFAULT 'MANAGE_PRODUCTION',
    "sendToProduction" "SendToProductionKind" NOT NULL DEFAULT 'DIRECT',
    "isTraining" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

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
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sellerId" TEXT NOT NULL,
    "seriesId" TEXT,
    "clientId" TEXT,
    "companyId" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'OPEN',
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "contactType" TEXT,
    "tagId" TEXT,
    "quickSale" BOOLEAN NOT NULL DEFAULT false,
    "quotationNumber" INTEGER,
    "finishedAt" TIMESTAMP(3),
    "reasonId" TEXT,
    "subCompanyId" TEXT,
    "contactId" TEXT,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_products" (
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "totalValue" DOUBLE PRECISION,
    "description" TEXT,
    "allowEditDescription" BOOLEAN NOT NULL DEFAULT true,
    "allowEditValues" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "technicalDescription" TEXT,
    "notes" TEXT,
    "id" TEXT NOT NULL,
    "discount" DOUBLE PRECISION,
    "discountType" TEXT,
    "finalValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "quotation_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_product_items" (
    "productItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "productId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "totalValue" DOUBLE PRECISION,
    "distance" DOUBLE PRECISION,
    "duration" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "name" TEXT NOT NULL,
    "salePrice" DOUBLE PRECISION,
    "unitCost" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "id" TEXT NOT NULL,
    "quotationProductId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "originalQuantity" INTEGER NOT NULL DEFAULT 1,
    "unitKind" "UnitKind",
    "defaultUnitOfMeasureId" TEXT,

    CONSTRAINT "quotation_product_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_payments" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "downPayment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentMethodId" TEXT,
    "paymentConditionId" TEXT,
    "commissionId" TEXT,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "finalValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "discountType" TEXT NOT NULL DEFAULT 'VALUE',
    "type" "InvoiceType" NOT NULL DEFAULT 'OTHER',
    "billing" "BiilingKind" NOT NULL DEFAULT 'ON_ORDER',
    "downPaymentConditionId" TEXT,
    "downPaymentDueDate" TIMESTAMP(3),
    "downPaymentAdditionalFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additionalFeeType" TEXT,
    "installmentQty" INTEGER,
    "mainAdditionalFee" DOUBLE PRECISION,
    "maxInstallmentQty" INTEGER,
    "minInstallmentQty" INTEGER,
    "discountTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "type" "CommissionType" NOT NULL DEFAULT 'ADD',
    "transferMethod" "transferMethodCommission" NOT NULL DEFAULT 'SINGLE',
    "commissionValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCommission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "supplierId" TEXT NOT NULL,
    "commissionType" TEXT NOT NULL DEFAULT 'VALUE',
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
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "payableInstallmentId" TEXT,
    "receivableInstallmentId" TEXT,
    "additionalFee" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_info" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "daysAfterApproval" INTEGER,
    "estimatedDate" TIMESTAMP(3),
    "modality" TEXT NOT NULL DEFAULT 'Indefinida',
    "cost" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "notes" TEXT,
    "supplierId" TEXT,
    "clientAddressId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "deliveryType" "DeliveryType" NOT NULL DEFAULT 'PICKUP',

    CONSTRAINT "delivery_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "quotationId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'IN_PRODUCTION',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canceledAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "reasonId" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT,
    "categoryId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isStandard" BOOLEAN NOT NULL DEFAULT false,
    "code" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "allowEditDescription" BOOLEAN NOT NULL DEFAULT true,
    "allowEditValues" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "technicalDescription" TEXT,
    "productionStages" JSONB,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "salePrice" DOUBLE PRECISION,
    "distance" DOUBLE PRECISION,
    "duration" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "unitKind" "UnitKind",
    "defaultUnitOfMeasureId" TEXT,

    CONSTRAINT "product_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "default_unit_measures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "kind" "UnitKind",

    CONSTRAINT "default_unit_measures_pkey" PRIMARY KEY ("id")
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
    "status" "DeliveryScheduleStatus" NOT NULL DEFAULT 'IN_PRODUCTION',
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT,
    "level1" TEXT,
    "level2" TEXT,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "natures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_categories" (
    "id" TEXT NOT NULL,
    "description" TEXT,
    "natureId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT,
    "companyId" TEXT NOT NULL,

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
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "additionalUserPrice" DOUBLE PRECISION DEFAULT 0,
    "basePrice" DOUBLE PRECISION NOT NULL,
    "planType" "PlanType" NOT NULL DEFAULT 'START',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_limits" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "limitId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asaasEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "phone" TEXT,
    "asaasCustomerId" TEXT NOT NULL,
    "address" TEXT,
    "addressNumber" TEXT,
    "complement" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "state" TEXT,
    "company_id" TEXT,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "companyId" TEXT,
    "additionalUsers" INTEGER NOT NULL DEFAULT 0,
    "asaasSubscriptionId" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "plan_id" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingType" "BillingType" NOT NULL DEFAULT 'CREDIT_CARD',
    "cycle" "Cycle" NOT NULL DEFAULT 'MONTHLY',

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_features" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_features_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "academy" (
    "id" TEXT NOT NULL,
    "type" TEXT[] DEFAULT ARRAY['START', 'LITE', 'PRO', 'ELITE', 'FULL']::TEXT[],
    "section" TEXT NOT NULL DEFAULT 'Apresentação',
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "videoUrl" TEXT NOT NULL DEFAULT 'https://vimeo.com/43652787',
    "page" TEXT DEFAULT '/',
    "modal" TEXT DEFAULT 'CompanyInfo',
    "buttonTitle" TEXT DEFAULT 'Cadastrar dados',
    "files" TEXT[],

    CONSTRAINT "academy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academy_progress" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "academySystemId" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "academy_progress_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "payroll_employeeId_month_year_key" ON "payroll"("employeeId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_template_name_type_companyId_key" ON "payroll_template"("name", "type", "companyId");

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
CREATE UNIQUE INDEX "default_unit_measures_code_key" ON "default_unit_measures"("code");

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
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "features_key_key" ON "features"("key");

-- CreateIndex
CREATE UNIQUE INDEX "limits_key_key" ON "limits"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_features_planId_featureId_key" ON "plan_features"("planId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_limits_planId_limitId_key" ON "plan_limits"("planId", "limitId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_asaasEventId_key" ON "webhook_events"("asaasEventId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_document_key" ON "customers"("document");

-- CreateIndex
CREATE UNIQUE INDEX "customers_asaasCustomerId_key" ON "customers"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_asaasSubscriptionId_key" ON "subscriptions"("asaasSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_features_subscriptionId_featureId_key" ON "subscription_features"("subscriptionId", "featureId");

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
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_profile" ADD CONSTRAINT "seller_profile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "clients" ADD CONSTRAINT "clients_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "seller_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "asset_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_types" ADD CONSTRAINT "asset_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_history" ADD CONSTRAINT "receivable_history_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_scheduledExpenseId_fkey" FOREIGN KEY ("scheduledExpenseId") REFERENCES "scheduled_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_installments" ADD CONSTRAINT "payable_installments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_history" ADD CONSTRAINT "payable_history_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll" ADD CONSTRAINT "payroll_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll" ADD CONSTRAINT "payroll_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "payroll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_setup" ADD CONSTRAINT "payroll_setup_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_setup" ADD CONSTRAINT "payroll_setup_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_setup" ADD CONSTRAINT "payroll_setup_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "payroll_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_template" ADD CONSTRAINT "payroll_template_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_flow" ADD CONSTRAINT "financial_flow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "natures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_cash_controls" ADD CONSTRAINT "bank_account_cash_controls_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_cash_controls" ADD CONSTRAINT "bank_account_cash_controls_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account_cash_controls" ADD CONSTRAINT "bank_account_cash_controls_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_conditions" ADD CONSTRAINT "payment_conditions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_conditions" ADD CONSTRAINT "payment_conditions_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configurations" ADD CONSTRAINT "payment_configurations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configurations" ADD CONSTRAINT "payment_configurations_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configurations" ADD CONSTRAINT "payment_configurations_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_series" ADD CONSTRAINT "sale_series_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_quotation" ADD CONSTRAINT "status_quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "sale_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_subCompanyId_fkey" FOREIGN KEY ("subCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "status_quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "product_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_quotationProductId_fkey" FOREIGN KEY ("quotationProductId") REFERENCES "quotation_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_defaultUnitOfMeasureId_fkey" FOREIGN KEY ("defaultUnitOfMeasureId") REFERENCES "default_unit_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_downPaymentConditionId_fkey" FOREIGN KEY ("downPaymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_payableInstallmentId_fkey" FOREIGN KEY ("payableInstallmentId") REFERENCES "payable_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_quotationPaymentId_fkey" FOREIGN KEY ("quotationPaymentId") REFERENCES "quotation_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_installments" ADD CONSTRAINT "quotation_installments_receivableInstallmentId_fkey" FOREIGN KEY ("receivableInstallmentId") REFERENCES "receivable_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_info" ADD CONSTRAINT "delivery_info_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_info" ADD CONSTRAINT "delivery_info_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_info" ADD CONSTRAINT "delivery_info_clientAddressId_fkey" FOREIGN KEY ("clientAddressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_defaultUnitOfMeasureId_fkey" FOREIGN KEY ("defaultUnitOfMeasureId") REFERENCES "default_unit_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "languages" ADD CONSTRAINT "languages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reasons" ADD CONSTRAINT "reasons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_deliveryInfoId_fkey" FOREIGN KEY ("deliveryInfoId") REFERENCES "delivery_info"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_schedules" ADD CONSTRAINT "delivery_schedules_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "delivery_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "supplier_payment_conditions" ADD CONSTRAINT "supplier_payment_conditions_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_conditions" ADD CONSTRAINT "supplier_payment_conditions_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_limitId_fkey" FOREIGN KEY ("limitId") REFERENCES "limits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_features" ADD CONSTRAINT "subscription_features_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_features" ADD CONSTRAINT "subscription_features_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contracts" ADD CONSTRAINT "user_contracts_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contracts" ADD CONSTRAINT "user_contracts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_progress" ADD CONSTRAINT "academy_progress_academySystemId_fkey" FOREIGN KEY ("academySystemId") REFERENCES "academy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_progress" ADD CONSTRAINT "academy_progress_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuotationToProduct" ADD CONSTRAINT "_QuotationToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuotationToProduct" ADD CONSTRAINT "_QuotationToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
