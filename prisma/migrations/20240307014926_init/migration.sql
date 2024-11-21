-- CreateEnum
CREATE TYPE "PaymentConditionCostType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_conditions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acceptInstallments" BOOLEAN NOT NULL,
    "costType" "PaymentConditionCostType" NOT NULL,
    "operatorFeeRate" DOUBLE PRECISION,
    "operatorFeeTransfer" DOUBLE PRECISION,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_conditions_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_conditions" ADD CONSTRAINT "payment_conditions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configurations" ADD CONSTRAINT "payment_configurations_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configurations" ADD CONSTRAINT "payment_configurations_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_configurations" ADD CONSTRAINT "payment_configurations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
