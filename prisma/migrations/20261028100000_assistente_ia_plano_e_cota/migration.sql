-- Assistente de IA por plano e com cota mensal (agente do START e do LITE,
-- fase 1, 28/10/2026).
--
-- 1. A tabela ai_usage: o consumo de cada empresa no mês (mensagens que
--    chegaram ao modelo, tokens, custo e propostas).
-- 2. A chave `ai_assistant` entra no catálogo e liga no TRIAL (que começa com
--    o que o START tem), no START e nos planos acima, que são cumulativos.
--    O interruptor global (system_settings.ai_access_enabled) continua: com
--    ele desligado, ninguém usa.
-- 3. O limite `ai_messages_month` entra no catálogo com a sugestão de partida
--    (IA-6): 300 mensagens por mês no TRIAL e no START, 1.000 no LITE e nos
--    planos acima. O superadmin muda no painel de planos.
--
-- Como nas chaves outsourced_item e paper_register: só os planos globais,
-- pulando o plano que já tem a linha e o plano em que o superadmin já decidiu
-- a chave ou o limite pelo painel (linha em plan_config_history). Cada plano
-- ligado ganha a sua linha no histórico, com metadata.source = 'MIGRATION'.
-- Idempotente: rodar de novo não acha nada a mudar. Os textos são os de
-- src/seeds/features-base.ts e src/seeds/limits-base.ts.

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "actionsProposed" INTEGER NOT NULL DEFAULT 0,
    "actionsApplied" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_month_idx" ON "ai_usage"("month");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_companyId_month_key" ON "ai_usage"("companyId", "month");

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O recurso de plano
INSERT INTO "features" (
  "id",
  "key",
  "name",
  "description",
  "category",
  "price",
  "isActive",
  "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'ai_assistant',
  'Assistente de IA',
  'Assistente que consulta os dados da empresa e propõe orçamentos, descritivos e lançamentos para a pessoa confirmar',
  'configuration',
  0,
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

WITH "alvo" AS (
  SELECT
    p."id" AS "planId",
    p."planType"::text AS "planType",
    p."name" AS "planName",
    f."id" AS "featureId",
    f."name" AS "featureName"
  FROM "plans" p
  CROSS JOIN "features" f
  WHERE f."key" = 'ai_assistant'
    AND p."companyId" IS NULL
    AND p."planType"::text IN ('TRIAL', 'START', 'LITE', 'PRO', 'ELITE', 'FULL')
    AND NOT EXISTS (
      SELECT 1
      FROM "plan_features" pf
      WHERE pf."planId" = p."id"
        AND pf."featureId" = f."id"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "plan_config_history" h
      WHERE h."planId" = p."id"
        AND h."entityType" = 'PLAN_FEATURE'
        AND h."featureKey" = 'ai_assistant'
    )
),
"ligado" AS (
  INSERT INTO "plan_features" ("id", "planId", "featureId", "isActive", "createdAt")
  SELECT gen_random_uuid()::text, a."planId", a."featureId", true, NOW()
  FROM "alvo" a
  RETURNING "planId"
)
INSERT INTO "plan_config_history" (
  "id",
  "entityType",
  "planId",
  "planType",
  "featureKey",
  "action",
  "description",
  "changes",
  "metadata",
  "createdByName",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  'PLAN_FEATURE',
  a."planId",
  a."planType",
  'ai_assistant',
  'ENABLED',
  '"' || a."featureName" || '" incluído no plano ' || a."planName"
    || ' — Assistente de IA por plano, do START em diante (28/10/2026)',
  jsonb_build_object(
    'before', jsonb_build_object('enabled', false),
    'after', jsonb_build_object('enabled', true)
  ),
  jsonb_build_object(
    'source', 'MIGRATION',
    'migration', '20261028100000_assistente_ia_plano_e_cota'
  ),
  'Migração 2026-10',
  NOW()
FROM "alvo" a
JOIN "ligado" l ON l."planId" = a."planId";

-- O limite do plano: a cota mensal de mensagens
INSERT INTO "limits" (
  "id",
  "key",
  "name",
  "description",
  "unit",
  "isActive",
  "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'ai_messages_month',
  'Mensagens do assistente de IA por mês',
  'Mensagens enviadas ao assistente de IA no mês, somadas por empresa',
  'messages',
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

WITH "alvo" AS (
  SELECT
    p."id" AS "planId",
    p."planType"::text AS "planType",
    p."name" AS "planName",
    l."id" AS "limitId",
    l."name" AS "limitName",
    CASE WHEN p."planType"::text IN ('TRIAL', 'START') THEN 300 ELSE 1000 END
      AS "value"
  FROM "plans" p
  CROSS JOIN "limits" l
  WHERE l."key" = 'ai_messages_month'
    AND p."companyId" IS NULL
    AND p."planType"::text IN ('TRIAL', 'START', 'LITE', 'PRO', 'ELITE', 'FULL')
    AND NOT EXISTS (
      SELECT 1
      FROM "plan_limits" pl
      WHERE pl."planId" = p."id"
        AND pl."limitId" = l."id"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "plan_config_history" h
      WHERE h."planId" = p."id"
        AND h."entityType" = 'PLAN_LIMIT'
        AND h."limitKey" = 'ai_messages_month'
    )
),
"criado" AS (
  INSERT INTO "plan_limits" ("id", "planId", "limitId", "value", "isActive", "createdAt")
  SELECT gen_random_uuid()::text, a."planId", a."limitId", a."value", true, NOW()
  FROM "alvo" a
  RETURNING "planId"
)
INSERT INTO "plan_config_history" (
  "id",
  "entityType",
  "planId",
  "planType",
  "limitKey",
  "action",
  "description",
  "changes",
  "metadata",
  "createdByName",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  'PLAN_LIMIT',
  a."planId",
  a."planType",
  'ai_messages_month',
  'VALUE_CHANGED',
  a."limitName" || ' do plano ' || a."planName" || ': '
    || a."value"::text || ' — cota de partida do assistente de IA (28/10/2026)',
  jsonb_build_object(
    'before', jsonb_build_object('value', NULL),
    'after', jsonb_build_object('value', a."value")
  ),
  jsonb_build_object(
    'source', 'MIGRATION',
    'migration', '20261028100000_assistente_ia_plano_e_cota'
  ),
  'Migração 2026-10',
  NOW()
FROM "alvo" a
JOIN "criado" c ON c."planId" = a."planId";
