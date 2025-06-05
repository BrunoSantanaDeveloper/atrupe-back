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

-- CreateIndex
CREATE UNIQUE INDEX "credit_limit_payment_conditions_creditLimitDefaultId_paymen_key" ON "credit_limit_payment_conditions"("creditLimitDefaultId", "paymentConditionId");

-- AddForeignKey
ALTER TABLE "credit_limit_default" ADD CONSTRAINT "credit_limit_default_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limit_payment_conditions" ADD CONSTRAINT "credit_limit_payment_conditions_creditLimitDefaultId_fkey" FOREIGN KEY ("creditLimitDefaultId") REFERENCES "credit_limit_default"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limit_payment_conditions" ADD CONSTRAINT "credit_limit_payment_conditions_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
