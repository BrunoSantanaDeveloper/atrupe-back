-- Ciclo anual e parcelamento no cartão.
--
-- Aditivo e reexecutável (IF NOT EXISTS), como as anteriores: as assinaturas
-- existentes seguem como estão — billingMode nulo vale o prefixo de
-- asaasSubscriptionId.

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billingMode" TEXT,
ADD COLUMN IF NOT EXISTS "installmentCount" INTEGER,
ADD COLUMN IF NOT EXISTS "asaasInstallmentId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "asaasInstallmentId" TEXT,
ADD COLUMN IF NOT EXISTS "installmentNumber" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_asaasInstallmentId_idx" ON "payments"("asaasInstallmentId");
