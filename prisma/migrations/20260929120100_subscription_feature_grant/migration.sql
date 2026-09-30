-- Recurso concedido a uma assinatura sem cobrança, fora do plano:
-- PLAN_RETAINED (mantido quando o recurso saiu do plano sem atingir as
-- assinaturas atuais) ou COURTESY (cortesia dada pelo superadmin). Nulo nas
-- linhas existentes: são módulos contratados.
ALTER TABLE "subscription_features" ADD COLUMN IF NOT EXISTS "grantSource" TEXT;
ALTER TABLE "subscription_features" ADD COLUMN IF NOT EXISTS "grantedBy" TEXT;
ALTER TABLE "subscription_features" ADD COLUMN IF NOT EXISTS "grantedByName" TEXT;
ALTER TABLE "subscription_features" ADD COLUMN IF NOT EXISTS "grantReason" TEXT;
ALTER TABLE "subscription_features" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
