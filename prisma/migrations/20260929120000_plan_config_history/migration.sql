-- Trilha da configuração dos planos feita pelo superadmin (recursos por plano,
-- limites e disponibilidade). Sem FK de propósito: o histórico sobrevive à
-- exclusão de um plano ou recurso.
CREATE TABLE IF NOT EXISTS "plan_config_history" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "planId" TEXT,
    "planType" TEXT,
    "featureKey" TEXT,
    "limitKey" TEXT,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "createdBy" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_config_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "plan_config_history_planId_idx" ON "plan_config_history"("planId");
CREATE INDEX IF NOT EXISTS "plan_config_history_featureKey_idx" ON "plan_config_history"("featureKey");
CREATE INDEX IF NOT EXISTS "plan_config_history_createdAt_idx" ON "plan_config_history"("createdAt");
