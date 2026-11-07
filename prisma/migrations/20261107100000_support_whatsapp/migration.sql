-- Atendimento no WhatsApp com robô de IA e equipe: as sugestões de
-- conhecimento que esperam aprovação do superadmin e as passagens do robô
-- para a equipe (relatório das lacunas). O estado da conta no Chatwoot e a
-- configuração do robô ficam em system_settings.
CREATE TABLE IF NOT EXISTS "support_suggestions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "why" TEXT NOT NULL DEFAULT '',
    "suggestedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "support_suggestions_owner_tenantId_createdAt_idx" ON "support_suggestions"("owner", "tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "support_gap_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "excerpt" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_gap_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "support_gap_events_tenantId_at_idx" ON "support_gap_events"("tenantId", "at");
