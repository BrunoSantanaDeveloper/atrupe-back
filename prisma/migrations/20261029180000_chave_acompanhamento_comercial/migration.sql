-- Acompanhamento comercial é do LITE (CRM-7, decisão do produto de
-- 29/10/2026): a chave `sales_follow_up` entra no catálogo e liga no LITE e
-- nos planos acima dele, que são cumulativos. Até aqui o CRM chegava ao
-- START sem chave. Só dados; nenhuma coluna muda.
--
-- O dado fica pronto no mesmo deploy, como nas chaves paper_register e
-- outsourced_item. O texto do recurso é o de src/seeds/features-base.ts.
--
-- Só os planos globais, pulando o plano que já tem a linha em plan_features
-- e o plano em que o superadmin já decidiu esta chave pelo painel (linha
-- PLAN_FEATURE/sales_follow_up em plan_config_history). Cada plano ligado
-- ganha a sua linha no histórico, com metadata.source = 'MIGRATION'.
-- Idempotente: rodar de novo não acha nada a mudar.

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
  'sales_follow_up',
  'Acompanhamento comercial',
  'Registrar contatos, marcar o próximo contato, a visão do dia na aba Aguardando, modelos de mensagem, e-mail diário e clientes sem compra',
  'quotations',
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
  WHERE f."key" = 'sales_follow_up'
    AND p."companyId" IS NULL
    AND p."planType"::text IN ('LITE', 'PRO', 'ELITE', 'FULL')
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
        AND h."featureKey" = 'sales_follow_up'
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
  'sales_follow_up',
  'ENABLED',
  '"' || a."featureName" || '" incluído no plano ' || a."planName"
    || ' — Acompanhamento comercial do LITE em diante (CRM-7, decisão do produto de 29/10/2026)',
  jsonb_build_object(
    'before', jsonb_build_object('enabled', false),
    'after', jsonb_build_object('enabled', true)
  ),
  jsonb_build_object(
    'source', 'MIGRATION',
    'migration', '20261029180000_chave_acompanhamento_comercial'
  ),
  'Migração 2026-10',
  NOW()
FROM "alvo" a
JOIN "ligado" l ON l."planId" = a."planId";
