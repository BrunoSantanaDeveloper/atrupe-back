-- Papéis no LITE (decisão do PO de 13/10/2026): a chave `paper_register`
-- (cadastro de papel sem custo nem preço e contagem de folhas) entra no
-- catálogo e liga no LITE e nos planos acima dele. Os planos são cumulativos
-- (START < LITE < PRO < ELITE < FULL): o que o LITE tem, os de cima têm.
-- Só dados; nenhuma coluna muda.
--
-- O seed também cria a linha que falta, mas roda depois das migrations: aqui
-- o dado fica pronto no mesmo deploy, com a trilha do painel. O texto do
-- recurso é o de src/seeds/features-base.ts.
--
-- Só os planos globais LITE, PRO, ELITE e FULL (o TRIAL começa com o que o
-- START tem), pulando o plano que já tem a linha em plan_features e o plano
-- em que o superadmin já decidiu esta chave pelo painel (linha
-- PLAN_FEATURE/paper_register em plan_config_history). Cada plano ligado
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
  'paper_register',
  'Papéis',
  'Cadastro de papéis (gramatura, formato da folha e área útil, sem custo nem preço) e contagem de folhas no item e na ficha.',
  'products',
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
  WHERE f."key" = 'paper_register'
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
        AND h."featureKey" = 'paper_register'
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
  'paper_register',
  'ENABLED',
  '"' || a."featureName" || '" incluído no plano ' || a."planName"
    || ' — Papéis no LITE (decisão do PO de 13/10/2026)',
  jsonb_build_object(
    'before', jsonb_build_object('enabled', false),
    'after', jsonb_build_object('enabled', true)
  ),
  jsonb_build_object(
    'source', 'MIGRATION',
    'migration', '20261020140000_chave_paper_register'
  ),
  'Migração 2026-10',
  NOW()
FROM "alvo" a
JOIN "ligado" l ON l."planId" = a."planId";
