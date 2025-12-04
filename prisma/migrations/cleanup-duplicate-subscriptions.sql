-- Script para limpar assinaturas duplicadas
-- Mantém apenas a assinatura mais recente para cada combinação (companyId, status)

-- 1. Criar tabela temporária com os IDs das assinaturas a manter
CREATE TEMP TABLE subscriptions_to_keep AS
SELECT DISTINCT ON ("companyId", status) id
FROM subscriptions
WHERE "companyId" IS NOT NULL
ORDER BY "companyId", status, "createdAt" DESC;

-- 2. Mostrar quantas assinaturas serão deletadas (apenas para verificação)
SELECT
  COUNT(*) as total_duplicates_to_delete,
  (SELECT COUNT(*) FROM subscriptions WHERE "companyId" IS NOT NULL) as total_subscriptions,
  (SELECT COUNT(*) FROM subscriptions_to_keep) as subscriptions_to_keep
FROM subscriptions s
WHERE s."companyId" IS NOT NULL
  AND s.id NOT IN (SELECT id FROM subscriptions_to_keep);

-- 3. ATENÇÃO: Descomente a linha abaixo apenas se você revisou e quer realmente deletar
-- DELETE FROM subscriptions
-- WHERE "companyId" IS NOT NULL
--   AND id NOT IN (SELECT id FROM subscriptions_to_keep);

-- 4. Limpar tabela temporária
DROP TABLE subscriptions_to_keep;
