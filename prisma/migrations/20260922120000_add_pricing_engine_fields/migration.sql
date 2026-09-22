-- Motor de preço, contratação e diagnóstico de webhook.
--
-- Tudo aditivo e opcional: as assinaturas e cobranças existentes seguem
-- funcionando como estão, e o código antigo não lê estas colunas. IF NOT
-- EXISTS torna o arquivo reexecutável, para poder ser aplicado à mão antes
-- do deploy sem conflitar com o `prisma migrate deploy` depois.

-- AlterTable
-- attempts/lastError: o webhook responde 200 mesmo quando falha (erro
-- repetido faz o Asaas interromper a fila da conta); a falha fica registrada
-- aqui e o evento volta a ser tentado automaticamente.
ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "webhook_events" ADD COLUMN IF NOT EXISTS "resourceId" TEXT;

-- AlterTable
-- contractedAt: início do ciclo contratado. Sem ele não há crédito de
-- evolução — decisão de produto para as assinaturas anteriores a esta fase.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "contractedAt" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "endedReason" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "evolutionCreditCents" INTEGER;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "previousSubscriptionId" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "pricingSnapshot" JSONB;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "recurringValueCents" INTEGER;

-- AlterTable
-- grossValue/creditApplied/período: o crédito proporcional é calculado sobre
-- o que foi efetivamente pago pelo ciclo, antes do crédito anterior.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "creditApplied" DOUBLE PRECISION;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "grossValue" DOUBLE PRECISION;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "periodEnd" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "periodStart" TIMESTAMP(3);
