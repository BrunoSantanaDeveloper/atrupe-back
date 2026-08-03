-- Fase 3 da centralizacao fiscal: numeracao por (emissor, ambiente, docType).
--
-- PROBLEMA
-- Ate aqui, so a NFC-e tinha numeracao por ambiente
-- (invoicy_environment_configs.nfceSeries/nfceNextNumber). NF-e e NFS-e usavam
-- invoicy_configs.serieNfe/proximoNumeroNfe e serieNfse/proximoRpsNfse, que sao
-- GLOBAIS: a mesma sequencia era usada em homologacao e em producao. Emitir em
-- homologacao consumia numero de producao.
--
-- ESTA MIGRATION
--   1. Adiciona os pares de numeracao de NF-e e NFS-e em
--      invoicy_environment_configs.
--   2. Alinha o DEFAULT de docType (o schema Prisma nao o declarava, o banco
--      sim — divergencia da migration 20260701130000).
--   3. Cria as linhas de ambiente que faltam para NFE e NFSE, copiando a
--      numeracao legada para o ambiente ATIVO de cada docType e semeando o
--      outro ambiente com sequencia independente (serie 1 / proximo 1).
--   4. Cria indice unico parcial garantindo no maximo um emissor padrao por
--      empresa.
--
-- IDEMPOTENTE. Nao remove as colunas legadas de invoicy_configs — elas seguem
-- como fonte de leitura ate o codigo passar a ler das linhas ambientais.
--
-- ATENCAO OPERACIONAL: rode com a aplicacao em manutencao e com backup.
-- Depois valide comparando max(numero) por (serie, ambiente) em nfes/nfses
-- contra o nextNumber migrado. Numero duplicado em producao exige
-- inutilizacao junto a SEFAZ.

-- 1. Colunas de numeracao por docType
ALTER TABLE "invoicy_environment_configs"
  ADD COLUMN IF NOT EXISTS "nfeNextNumber"  INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "nfeSeries"      INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "nfseNextNumber" INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "nfseSeries"     TEXT    DEFAULT 'A1';

-- 2. Alinhar o default de docType ao que o banco ja praticava
ALTER TABLE "invoicy_environment_configs" ALTER COLUMN "docType" SET DEFAULT 'NFCE';

-- 3. Criar as linhas de ambiente faltantes para NFE e NFSE.
--
-- Para cada emissor e cada ambiente, garante uma linha (NFE) e uma (NFSE).
-- A numeracao legada vai para o ambiente ativo daquele docType; quando nao ha
-- ambiente ativo definido, considera-se HOMOLOGACAO (que e o default de
-- ativacao do sistema). O outro ambiente comeca em 1.
--
-- status DRAFT de proposito: criar a linha nao significa ambiente ativado.
-- A ativacao continua sendo responsabilidade do assistente.

INSERT INTO "invoicy_environment_configs"
  ("id", "invoicyConfigId", "environment", "docType",
   "nfeSeries", "nfeNextNumber", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."id",
  env.v,
  'NFE'::"FiscalDocType",
  CASE WHEN env.v = COALESCE(c."activeEnvironmentNfe", 'HOMOLOGACAO'::"FiscalEnvironment")
       THEN COALESCE(c."serieNfe", 1) ELSE 1 END,
  CASE WHEN env.v = COALESCE(c."activeEnvironmentNfe", 'HOMOLOGACAO'::"FiscalEnvironment")
       THEN COALESCE(c."proximoNumeroNfe", 1) ELSE 1 END,
  'DRAFT'::"FiscalEnvironmentStatus",
  NOW(),
  NOW()
FROM "invoicy_configs" c
CROSS JOIN (VALUES ('HOMOLOGACAO'::"FiscalEnvironment"), ('PRODUCAO'::"FiscalEnvironment")) AS env(v)
ON CONFLICT ("invoicyConfigId", "environment", "docType") DO NOTHING;

INSERT INTO "invoicy_environment_configs"
  ("id", "invoicyConfigId", "environment", "docType",
   "nfseSeries", "nfseNextNumber", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."id",
  env.v,
  'NFSE'::"FiscalDocType",
  CASE WHEN env.v = COALESCE(c."activeEnvironmentNfse", 'HOMOLOGACAO'::"FiscalEnvironment")
       THEN COALESCE(c."serieNfse", 'A1') ELSE 'A1' END,
  CASE WHEN env.v = COALESCE(c."activeEnvironmentNfse", 'HOMOLOGACAO'::"FiscalEnvironment")
       THEN COALESCE(c."proximoRpsNfse", 1) ELSE 1 END,
  'DRAFT'::"FiscalEnvironmentStatus",
  NOW(),
  NOW()
FROM "invoicy_configs" c
CROSS JOIN (VALUES ('HOMOLOGACAO'::"FiscalEnvironment"), ('PRODUCAO'::"FiscalEnvironment")) AS env(v)
ON CONFLICT ("invoicyConfigId", "environment", "docType") DO NOTHING;

-- Tambem garante as linhas de NFC-e para os dois ambientes, preservando a
-- numeracao ja existente onde houver.
INSERT INTO "invoicy_environment_configs"
  ("id", "invoicyConfigId", "environment", "docType",
   "nfceSeries", "nfceNextNumber", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."id",
  env.v,
  'NFCE'::"FiscalDocType",
  CASE WHEN env.v = COALESCE(c."activeEnvironmentNfce", 'HOMOLOGACAO'::"FiscalEnvironment")
       THEN COALESCE(c."serieNfce", 1) ELSE 1 END,
  CASE WHEN env.v = COALESCE(c."activeEnvironmentNfce", 'HOMOLOGACAO'::"FiscalEnvironment")
       THEN COALESCE(c."proximoNumeroNfce", 1) ELSE 1 END,
  'DRAFT'::"FiscalEnvironmentStatus",
  NOW(),
  NOW()
FROM "invoicy_configs" c
CROSS JOIN (VALUES ('HOMOLOGACAO'::"FiscalEnvironment"), ('PRODUCAO'::"FiscalEnvironment")) AS env(v)
ON CONFLICT ("invoicyConfigId", "environment", "docType") DO NOTHING;

-- Preencher a numeracao de NFE/NFSE em linhas que ja existiam (criadas antes
-- desta migration com as colunas ainda nulas), respeitando o ambiente ativo.
UPDATE "invoicy_environment_configs" e
SET "nfeSeries"     = COALESCE(c."serieNfe", 1),
    "nfeNextNumber" = COALESCE(c."proximoNumeroNfe", 1)
FROM "invoicy_configs" c
WHERE e."invoicyConfigId" = c."id"
  AND e."docType" = 'NFE'::"FiscalDocType"
  AND e."environment" = COALESCE(c."activeEnvironmentNfe", 'HOMOLOGACAO'::"FiscalEnvironment")
  AND (e."nfeNextNumber" IS NULL OR e."nfeNextNumber" = 1);

UPDATE "invoicy_environment_configs" e
SET "nfseSeries"     = COALESCE(c."serieNfse", 'A1'),
    "nfseNextNumber" = COALESCE(c."proximoRpsNfse", 1)
FROM "invoicy_configs" c
WHERE e."invoicyConfigId" = c."id"
  AND e."docType" = 'NFSE'::"FiscalDocType"
  AND e."environment" = COALESCE(c."activeEnvironmentNfse", 'HOMOLOGACAO'::"FiscalEnvironment")
  AND (e."nfseNextNumber" IS NULL OR e."nfseNextNumber" = 1);

-- 4. No maximo um emissor padrao por empresa.
--
-- Indice parcial: o Prisma nao consegue expressa-lo no schema, entao vive so
-- aqui. Se falhar, ha empresa com mais de um isDefault — rode antes
-- scripts/fiscal-phase0-census.ts para localizar e corrigir.
CREATE UNIQUE INDEX IF NOT EXISTS "invoicy_configs_one_default_per_company"
  ON "invoicy_configs" ("companyId")
  WHERE "isDefault";
