-- CreateEnum
CREATE TYPE "FiscalDocType" AS ENUM ('NFE', 'NFSE', 'NFCE');

-- AlterTable invoicy_environment_configs: add docType column with default NFCE
ALTER TABLE "invoicy_environment_configs" ADD COLUMN "docType" "FiscalDocType" NOT NULL DEFAULT 'NFCE';

-- Drop old unique constraint (invoicyConfigId, environment)
ALTER TABLE "invoicy_environment_configs" DROP CONSTRAINT "invoicy_environment_configs_invoicyConfigId_environment_key";

-- Add new unique constraint (invoicyConfigId, environment, docType)
ALTER TABLE "invoicy_environment_configs" ADD CONSTRAINT "invoicy_environment_configs_invoicyConfigId_environment_docType_key" UNIQUE ("invoicyConfigId", "environment", "docType");

-- AlterTable fiscal_activation_attempts: add docType column
ALTER TABLE "fiscal_activation_attempts" ADD COLUMN "docType" "FiscalDocType" NOT NULL DEFAULT 'NFCE';

-- Drop old unique constraint (invoicyConfigId, environment, idempotencyKey)
ALTER TABLE "fiscal_activation_attempts" DROP CONSTRAINT "fiscal_activation_attempts_invoicyConfigId_environment_idempotencyKey_key";

-- Add new unique constraint (invoicyConfigId, environment, docType, idempotencyKey)
ALTER TABLE "fiscal_activation_attempts" ADD CONSTRAINT "fiscal_activation_attempts_invoicyConfigId_environment_docType_idempotencyKey_key" UNIQUE ("invoicyConfigId", "environment", "docType", "idempotencyKey");

-- Drop old index (invoicyConfigId, status)
DROP INDEX IF EXISTS "fiscal_activation_attempts_invoicyConfigId_status_idx";

-- Add new index (invoicyConfigId, docType, status)
CREATE INDEX "fiscal_activation_attempts_invoicyConfigId_docType_status_idx" ON "fiscal_activation_attempts"("invoicyConfigId", "docType", "status");

-- AlterTable invoicy_configs: add per-docType active environment fields
ALTER TABLE "invoicy_configs" ADD COLUMN "activeEnvironmentNfe" "FiscalEnvironment";
ALTER TABLE "invoicy_configs" ADD COLUMN "activeEnvironmentNfse" "FiscalEnvironment";
ALTER TABLE "invoicy_configs" ADD COLUMN "activeEnvironmentNfce" "FiscalEnvironment";

-- Populate activeEnvironmentNfce from existing activeEnvironment
-- (pre-migration activations were all NFC-e)
UPDATE "invoicy_configs"
SET "activeEnvironmentNfce" = "activeEnvironment"
WHERE "activeEnvironment" IS NOT NULL;
