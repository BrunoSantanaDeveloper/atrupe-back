-- Adicionar UNKNOWN ao enum NfceStatus
ALTER TYPE "NfceStatus" ADD VALUE 'UNKNOWN';

-- Adicionar coluna invoicyConfigId (FK para invoicy_configs)
ALTER TABLE "nfces" ADD COLUMN "invoicyConfigId" TEXT;

-- Adicionar coluna invoicyPayloadEnvio (payload exato usado na emissão)
ALTER TABLE "nfces" ADD COLUMN "invoicyPayloadEnvio" JSONB;

-- Adicionar FK constraint
ALTER TABLE "nfces" ADD CONSTRAINT "nfces_invoicyConfigId_fkey"
  FOREIGN KEY ("invoicyConfigId") REFERENCES "invoicy_configs"(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Criar índice em invoicyConfigId
CREATE INDEX "nfces_invoicyConfigId_idx" ON "nfces"("invoicyConfigId");

-- Remover índice redundante (numero, serie, companyId) pois será substituído pela unique constraint
DROP INDEX IF EXISTS "nfces_numero_serie_companyId_idx";

-- Adicionar unique constraint (aplicável somente após garantir que não há duplicatas existentes)
-- Verificar antes com: SELECT "companyId", numero, serie, ambiente, COUNT(*) FROM nfces GROUP BY "companyId", numero, serie, ambiente HAVING COUNT(*) > 1;
ALTER TABLE "nfces" ADD CONSTRAINT "nfce_unique_emission"
  UNIQUE ("companyId", numero, serie, ambiente);
