-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "FiscalDocType" AS ENUM ('NFE', 'NFSE', 'NFCE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable invoicy_environment_configs: add docType column with default NFCE
ALTER TABLE "invoicy_environment_configs" ADD COLUMN IF NOT EXISTS "docType" "FiscalDocType" NOT NULL DEFAULT 'NFCE';

-- Drop old unique constraint/index (idempotent) — may be a raw index depending on environment
ALTER TABLE "invoicy_environment_configs" DROP CONSTRAINT IF EXISTS "invoicy_environment_configs_invoicyConfigId_environment_key";
DROP INDEX IF EXISTS "invoicy_environment_configs_invoicyConfigId_environment_key";

-- Add new unique constraint (idempotent)
DO $$ BEGIN
  ALTER TABLE "invoicy_environment_configs" ADD CONSTRAINT "invoicy_environment_configs_invoicyConfigId_environment_docType_key" UNIQUE ("invoicyConfigId", "environment", "docType");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable fiscal_activation_attempts: add docType column
ALTER TABLE "fiscal_activation_attempts" ADD COLUMN IF NOT EXISTS "docType" "FiscalDocType" NOT NULL DEFAULT 'NFCE';

-- Drop old unique constraint/index (idempotent) — may be a raw index depending on environment
ALTER TABLE "fiscal_activation_attempts" DROP CONSTRAINT IF EXISTS "fiscal_activation_attempts_invoicyConfigId_environment_idempotencyKey_key";
DROP INDEX IF EXISTS "fiscal_activation_attempts_invoicyConfigId_environment_idem_key";

-- Add new unique constraint (idempotent)
DO $$ BEGIN
  ALTER TABLE "fiscal_activation_attempts" ADD CONSTRAINT "fiscal_activation_attempts_invoicyConfigId_environment_docType_idempotencyKey_key" UNIQUE ("invoicyConfigId", "environment", "docType", "idempotencyKey");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Drop old index
DROP INDEX IF EXISTS "fiscal_activation_attempts_invoicyConfigId_status_idx";

-- Add new index (idempotent)
CREATE INDEX IF NOT EXISTS "fiscal_activation_attempts_invoicyConfigId_docType_status_idx" ON "fiscal_activation_attempts"("invoicyConfigId", "docType", "status");

-- AlterTable invoicy_configs: add per-docType active environment fields
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "activeEnvironmentNfe" "FiscalEnvironment";
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "activeEnvironmentNfse" "FiscalEnvironment";
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "activeEnvironmentNfce" "FiscalEnvironment";

-- Populate activeEnvironmentNfce from existing activeEnvironment (safe to re-run)
UPDATE "invoicy_configs"
SET "activeEnvironmentNfce" = "activeEnvironment"
WHERE "activeEnvironment" IS NOT NULL AND "activeEnvironmentNfce" IS NULL;
