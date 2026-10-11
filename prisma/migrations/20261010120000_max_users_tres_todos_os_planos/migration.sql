-- 3 usuários em todos os planos (contrato da camada de planos, 10/10/2026).
-- O padrão de fábrica passou a 3 em src/seeds/plans-complete.ts, mas o seed
-- não sobrescreve limite que já existe: esta migration ajusta o dado.
--
-- Só o max_users dos planos globais LITE, PRO, ELITE e FULL (TRIAL e START já
-- são 3), pulando o plano em que o superadmin já mexeu nesse limite pelo
-- painel — a única marca disso é uma linha PLAN_LIMIT/max_users em
-- plan_config_history. Cada plano alterado ganha a sua linha no histórico,
-- com metadata.source = 'MIGRATION'. Idempotente: rodar de novo não acha
-- nada a mudar (o valor já é 3 e o histórico já existe).
--
-- Contas acima de 3 continuam funcionando: só não criam nem reativam
-- usuário acima de 3 + usuários adicionais.
WITH "alvo" AS (
  SELECT
    pl."id" AS "planLimitId",
    p."id" AS "planId",
    p."planType"::text AS "planType",
    p."name" AS "planName",
    l."name" AS "limitName",
    pl."value" AS "before"
  FROM "plan_limits" pl
  JOIN "plans" p ON p."id" = pl."planId"
  JOIN "limits" l ON l."id" = pl."limitId"
  WHERE l."key" = 'max_users'
    AND p."companyId" IS NULL
    AND p."planType"::text IN ('LITE', 'PRO', 'ELITE', 'FULL')
    AND pl."value" <> 3
    AND NOT EXISTS (
      SELECT 1
      FROM "plan_config_history" h
      WHERE h."planId" = p."id"
        AND h."entityType" = 'PLAN_LIMIT'
        AND h."limitKey" = 'max_users'
    )
),
"atualizado" AS (
  UPDATE "plan_limits" pl
  SET "value" = 3
  FROM "alvo" a
  WHERE pl."id" = a."planLimitId"
  RETURNING pl."id"
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
  'max_users',
  'VALUE_CHANGED',
  a."limitName" || ' do plano ' || a."planName" || ': '
    || CASE WHEN a."before" = -1 THEN 'ilimitado' ELSE a."before"::text END
    || ' → 3',
  jsonb_build_object(
    'before', jsonb_build_object('value', a."before"),
    'after', jsonb_build_object('value', 3)
  ),
  jsonb_build_object(
    'source', 'MIGRATION',
    'migration', '20261010120000_max_users_tres_todos_os_planos'
  ),
  'Migração 2026-10',
  NOW()
FROM "alvo" a
JOIN "atualizado" u ON u."id" = a."planLimitId";

-- O texto da trilha do LITE (Json plans.features) dizia "5 usuários". Troca
-- só se ainda estiver assim e o limite do LITE estiver em 3: se o superadmin
-- manteve outro valor no painel, o texto fica como estava.
UPDATE "plans" p
SET "features" = replace(p."features"::text, '"5 usuários"', '"3 usuários"')::jsonb
WHERE p."companyId" IS NULL
  AND p."planType"::text = 'LITE'
  AND p."features" IS NOT NULL
  AND p."features"::text LIKE '%"5 usuários"%'
  AND EXISTS (
    SELECT 1
    FROM "plan_limits" pl
    JOIN "limits" l ON l."id" = pl."limitId"
    WHERE pl."planId" = p."id"
      AND l."key" = 'max_users'
      AND pl."value" = 3
  );
