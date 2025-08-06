-- Backup dos dados críticos antes da migração
-- Execute este script para fazer backup dos dados que serão perdidos

-- Backup das subscriptions com additionalAccesses
CREATE TEMP TABLE subscriptions_backup AS 
SELECT id, "additionalAccesses", modules::text as modules_backup
FROM subscriptions 
WHERE "additionalAccesses" IS NOT NULL OR modules IS NOT NULL;

-- Backup dos plans com additionalAccessPrice
CREATE TEMP TABLE plans_backup AS
SELECT id, "additionalAccessPrice", modules::text as modules_backup
FROM plans 
WHERE "additionalAccessPrice" IS NOT NULL OR modules IS NOT NULL;

-- Backup da tabela modules completa
CREATE TEMP TABLE modules_backup AS
SELECT * FROM modules;

-- Verificar os backups
SELECT 'subscriptions_backup' as table_name, COUNT(*) as records FROM subscriptions_backup
UNION ALL
SELECT 'plans_backup' as table_name, COUNT(*) as records FROM plans_backup  
UNION ALL
SELECT 'modules_backup' as table_name, COUNT(*) as records FROM modules_backup;