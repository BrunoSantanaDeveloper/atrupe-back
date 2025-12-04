#!/bin/bash

# Script para limpar assinaturas duplicadas antes de aplicar a migration
# Mantém apenas a assinatura mais recente para cada (companyId, status)

echo "🔍 Verificando duplicatas no banco de dados..."
echo ""

# Conectar ao banco e executar o script
PGPASSWORD="${DATABASE_PASSWORD:-postgres}" psql -h "${DATABASE_HOST:-localhost}" -p "${DATABASE_PORT:-5433}" -U "${DATABASE_USER:-postgres}" -d "${DATABASE_NAME:-atrupeDb}" << 'EOF'

-- Criar tabela temporária com os IDs das assinaturas a manter
CREATE TEMP TABLE subscriptions_to_keep AS
SELECT DISTINCT ON ("companyId", status) id
FROM subscriptions
WHERE "companyId" IS NOT NULL
ORDER BY "companyId", status, "createdAt" DESC;

-- Mostrar quantas assinaturas serão deletadas
\echo ''
\echo '📊 Estatísticas:'
\echo ''
SELECT
  COUNT(*) as "Duplicatas a deletar",
  (SELECT COUNT(*) FROM subscriptions WHERE "companyId" IS NOT NULL) as "Total de assinaturas",
  (SELECT COUNT(*) FROM subscriptions_to_keep) as "Assinaturas a manter"
FROM subscriptions s
WHERE s."companyId" IS NOT NULL
  AND s.id NOT IN (SELECT id FROM subscriptions_to_keep);

-- Mostrar exemplos de duplicatas que serão deletadas
\echo ''
\echo '🔎 Exemplos de duplicatas (primeiras 10):'
\echo ''
SELECT
  c.name as "Empresa",
  s.status as "Status",
  COUNT(*) as "Quantidade",
  MIN(s."createdAt") as "Primeira criação",
  MAX(s."createdAt") as "Última criação"
FROM subscriptions s
JOIN companies c ON c.id = s."companyId"
WHERE s."companyId" IS NOT NULL
GROUP BY c.name, s.status
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 10;

\echo ''
\echo '⚠️  Pressione CTRL+C para cancelar ou ENTER para continuar e deletar as duplicatas...'
\prompt 'Confirmar deleção? (yes/no): ' confirm

-- Deletar duplicatas se confirmado
\if :{?confirm}
  \if :confirm = 'yes'
    \echo ''
    \echo '🗑️  Deletando duplicatas...'
    DELETE FROM subscriptions
    WHERE "companyId" IS NOT NULL
      AND id NOT IN (SELECT id FROM subscriptions_to_keep);
    \echo '✅ Duplicatas deletadas com sucesso!'
  \else
    \echo '❌ Operação cancelada.'
  \endif
\else
  \echo '❌ Operação cancelada.'
\endif

-- Limpar tabela temporária
DROP TABLE subscriptions_to_keep;

EOF

echo ""
echo "✅ Script concluído!"
