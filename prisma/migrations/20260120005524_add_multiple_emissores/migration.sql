-- DropIndex
DROP INDEX IF EXISTS "invoicy_configs_companyId_key";

-- AlterTable: Primeiro adicionar colunas que podem ser nulas
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "certificate" TEXT;
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "certificatePassword" TEXT;
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT true;

-- Adicionar coluna name como nullable primeiro
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "name" TEXT;

-- Popular registros existentes com um nome padrão baseado na razão social ou "Emissor Principal"
UPDATE "invoicy_configs" 
SET "name" = COALESCE("emitNomeFantasia", "emitRazaoSocial", 'Emissor Principal')
WHERE "name" IS NULL;

-- Tornar a coluna name NOT NULL após popular os dados
ALTER TABLE "invoicy_configs" ALTER COLUMN "name" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoicy_configs_companyId_idx" ON "invoicy_configs"("companyId");
