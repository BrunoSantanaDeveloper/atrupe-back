-- Sem controle de tempo e a tela por setor do PRO (GP-46/GP-47, decisão do
-- produto de 29/10/2026): o gerenciador ganha o modo NONE (a tarefa só se
-- conclui) e a chave `sector_board` entra no catálogo e liga no PRO e nos
-- planos acima dele, que são cumulativos.

ALTER TYPE "ProductionTimeMode" ADD VALUE 'NONE';
--
-- O dado fica pronto no mesmo deploy, como nas chaves paper_register e
-- outsourced_item. O texto do recurso é o de src/seeds/features-base.ts.
--
-- Só os planos globais, pulando o plano que já tem a linha em plan_features
-- e o plano em que o superadmin já decidiu esta chave pelo painel (linha
-- PLAN_FEATURE/sector_board em plan_config_history). Cada plano ligado
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
  'sector_board',
  'Tela por setor da produção',
  'Cada setor vê a sua fila de tarefas e conclui o que é seu, sem controle de tempo',
  'production',
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
  WHERE f."key" = 'sector_board'
    AND p."companyId" IS NULL
    AND p."planType"::text IN ('PRO', 'ELITE', 'FULL')
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
        AND h."featureKey" = 'sector_board'
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
  'sector_board',
  'ENABLED',
  '"' || a."featureName" || '" incluído no plano ' || a."planName"
    || ' — Tela por setor da produção do PRO em diante (GP-46/GP-47, decisão do produto de 29/10/2026)',
  jsonb_build_object(
    'before', jsonb_build_object('enabled', false),
    'after', jsonb_build_object('enabled', true)
  ),
  jsonb_build_object(
    'source', 'MIGRATION',
    'migration', '20261029210000_sem_controle_de_tempo_e_tela_por_setor'
  ),
  'Migração 2026-10',
  NOW()
FROM "alvo" a
JOIN "ligado" l ON l."planId" = a."planId";
