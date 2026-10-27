-- Terceirizado avulso já no START (T-5, decisão do produto de 24/10/2026):
-- a chave `outsourced_item` entra no catálogo e liga no TRIAL (que começa com
-- o que o START tem), no START e nos planos acima dele, que são cumulativos.
-- Só dados; nenhuma coluna muda.
--
-- O pacote de 26/10 dependia de rodar o seed dos recursos e dos planos; aqui
-- o dado fica pronto no mesmo deploy, como na chave paper_register. O texto
-- do recurso é o de src/seeds/features-base.ts.
--
-- Só os planos globais, pulando o plano que já tem a linha em plan_features
-- e o plano em que o superadmin já decidiu esta chave pelo painel (linha
-- PLAN_FEATURE/outsourced_item em plan_config_history). Cada plano ligado
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
  'outsourced_item',
  'Terceirizado avulso',
  'Lançar um terceirizado (fornecedor, custo e preço) dentro do item do orçamento',
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
  WHERE f."key" = 'outsourced_item'
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
        AND h."featureKey" = 'outsourced_item'
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
  'outsourced_item',
  'ENABLED',
  '"' || a."featureName" || '" incluído no plano ' || a."planName"
    || ' — Terceirizado avulso já no START (T-5, decisão do produto de 24/10/2026)',
  jsonb_build_object(
    'before', jsonb_build_object('enabled', false),
    'after', jsonb_build_object('enabled', true)
  ),
  jsonb_build_object(
    'source', 'MIGRATION',
    'migration', '20261024160000_chave_terceirizado_avulso'
  ),
  'Migração 2026-10',
  NOW()
FROM "alvo" a
JOIN "ligado" l ON l."planId" = a."planId";
