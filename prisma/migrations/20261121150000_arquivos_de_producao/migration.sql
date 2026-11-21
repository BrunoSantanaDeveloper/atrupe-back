-- Arquivos de produção com espaço medido (GP-48 item 27, 21/11/2026).
--
-- 1. O recurso ganha `storageGb` (o espaço que a faixa dá) e `listed` (se
--    aparece no catálogo de complementos).
-- 2. As faixas entram como complementos pagos, cobrados na mensalidade pelo
--    caminho que já existe (complementos no Asaas): 50 GB por R$ 39,90 e
--    200 GB por R$ 99,90, no catálogo; 1 TB por R$ 399,90 fora do catálogo,
--    oferecido só a quem já tem uma faixa e passou de 80% do espaço.
-- 3. O limite `production_storage_free_mb` (a cota grátis de quem não
--    contrata) entra com 1.024 MB em todos os planos globais. O superadmin
--    muda no painel de planos.
--
-- Como nas migrações das chaves anteriores: só os planos globais, pulando o
-- plano que já tem a linha ou em que o superadmin já decidiu o limite pelo
-- painel. Idempotente. Os textos são os de src/seeds/features-base.ts e
-- src/seeds/limits-base.ts.

ALTER TABLE "features" ADD COLUMN "storageGb" INTEGER;
ALTER TABLE "features" ADD COLUMN "listed" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "features" (
  "id", "key", "name", "description", "category", "price", "isActive",
  "storageGb", "listed", "createdAt", "updatedAt"
)
VALUES
  (
    gen_random_uuid()::text,
    'production_storage_50gb',
    'Arquivos de produção · 50 GB',
    'Guarde os arquivos de cada trabalho (arte em alta resolução, PDF, CDR, AI, ZIP) nas etapas da produção, com até 2 GB por arquivo e 50 GB no total',
    'production',
    3990,
    true,
    50,
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid()::text,
    'production_storage_200gb',
    'Arquivos de produção · 200 GB',
    'Guarde os arquivos de cada trabalho (arte em alta resolução, PDF, CDR, AI, ZIP) nas etapas da produção, com até 2 GB por arquivo e 200 GB no total',
    'production',
    9990,
    true,
    200,
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid()::text,
    'production_storage_1tb',
    'Arquivos de produção · 1 TB',
    'Guarde os arquivos de cada trabalho (arte em alta resolução, PDF, CDR, AI, ZIP) nas etapas da produção, com até 2 GB por arquivo e 1 TB no total',
    'production',
    39990,
    true,
    1000,
    false,
    NOW(),
    NOW()
  )
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "limits" (
  "id", "key", "name", "description", "unit", "isActive", "createdAt",
  "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'production_storage_free_mb',
  'Espaço grátis dos arquivos de produção (MB)',
  'Espaço dos anexos da produção sem a faixa contratada, somado por empresa (todas as versões contam)',
  'MB',
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
    1024 AS "value"
  FROM "plans" p
  CROSS JOIN "limits" l
  WHERE l."key" = 'production_storage_free_mb'
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
        AND h."limitKey" = 'production_storage_free_mb'
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
  'production_storage_free_mb',
  'VALUE_CHANGED',
  a."limitName" || ' do plano ' || a."planName" || ': '
    || a."value"::text || ' — cota grátis dos arquivos de produção (21/11/2026)',
  jsonb_build_object(
    'before', jsonb_build_object('value', NULL),
    'after', jsonb_build_object('value', a."value")
  ),
  jsonb_build_object(
    'source', 'MIGRATION',
    'migration', '20261121150000_arquivos_de_producao'
  ),
  'Migração 2026-11',
  NOW()
FROM "alvo" a
JOIN "criado" c ON c."planId" = a."planId";
