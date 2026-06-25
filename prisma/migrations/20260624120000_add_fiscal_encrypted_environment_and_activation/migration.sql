-- CreateEnum
CREATE TYPE "FiscalEnvironment" AS ENUM ('HOMOLOGACAO', 'PRODUCAO');

-- CreateEnum
CREATE TYPE "FiscalEnvironmentStatus" AS ENUM ('DRAFT', 'VALIDATING', 'READY', 'ERROR', 'DISABLED', 'MIGRATED_UNVERIFIED');

-- CreateEnum
CREATE TYPE "FiscalConfigAction" AS ENUM ('ENVIRONMENT_CONFIG_CREATE', 'CREDENTIALS_ROTATE', 'ENVIRONMENT_ACTIVATED', 'VALIDATION_RUN', 'READ_CREDENTIALS', 'CERTIFICATE_UPLOADED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'ADMIN');

-- CreateEnum
CREATE TYPE "FiscalConfigHistoryResult" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "FiscalSecretMigrationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FiscalActivationStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "invoicy_configs" ADD COLUMN     "activeEnvironment" "FiscalEnvironment";

-- AlterTable
ALTER TABLE "digital_certificates" ADD COLUMN     "certificateEncrypted" TEXT,
ADD COLUMN     "passwordEncrypted" TEXT;

-- AlterTable
ALTER TABLE "fiscal_onboarding_requests" ADD COLUMN     "invoicyAccessKeyEncrypted" TEXT,
ADD COLUMN     "invoicyCryptoKeyEncrypted" TEXT;

-- CreateTable
CREATE TABLE "company_environment_credentials" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "providerAccessKeyEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_environment_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoicy_environment_configs" (
    "id" TEXT NOT NULL,
    "invoicyConfigId" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "cscId" TEXT,
    "cscTokenEncrypted" TEXT,
    "nfceSeries" INTEGER DEFAULT 1,
    "nfceNextNumber" INTEGER DEFAULT 1,
    "status" "FiscalEnvironmentStatus" NOT NULL DEFAULT 'DRAFT',
    "lastValidationAt" TIMESTAMP(3),
    "lastValidationError" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoicy_environment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoicy_config_history" (
    "id" TEXT NOT NULL,
    "invoicyConfigId" TEXT,
    "companyId" TEXT NOT NULL,
    "emissorName" TEXT NOT NULL,
    "action" "FiscalConfigAction" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "createdByName" TEXT NOT NULL,
    "environment" "FiscalEnvironment",
    "result" "FiscalConfigHistoryResult" NOT NULL,
    "correlationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoicy_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_activation_attempts" (
    "id" TEXT NOT NULL,
    "invoicyConfigId" TEXT NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "idempotencyKey" TEXT,
    "status" "FiscalActivationStatus" NOT NULL DEFAULT 'RUNNING',
    "attemptId" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "resultSnapshot" JSONB,
    "errorCode" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_activation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_secret_migration_state" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "FiscalSecretMigrationStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedOk" INTEGER NOT NULL DEFAULT 0,
    "processedError" INTEGER NOT NULL DEFAULT 0,
    "cursors" JSONB DEFAULT '{}',
    "snapshotTime" TIMESTAMP(3),
    "errorSanitized" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_secret_migration_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_secret_rekey_jobs" (
    "id" TEXT NOT NULL,
    "oldKeyId" TEXT NOT NULL,
    "newKeyId" TEXT NOT NULL,
    "status" "FiscalSecretMigrationStatus" NOT NULL DEFAULT 'PENDING',
    "cursors" JSONB NOT NULL DEFAULT '{}',
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_secret_rekey_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_environment_credentials_companyId_environment_key" ON "company_environment_credentials"("companyId", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "invoicy_environment_configs_invoicyConfigId_environment_key" ON "invoicy_environment_configs"("invoicyConfigId", "environment");

-- CreateIndex
CREATE INDEX "invoicy_config_history_invoicyConfigId_idx" ON "invoicy_config_history"("invoicyConfigId");

-- CreateIndex
CREATE INDEX "invoicy_config_history_companyId_idx" ON "invoicy_config_history"("companyId");

-- CreateIndex
CREATE INDEX "invoicy_config_history_createdAt_idx" ON "invoicy_config_history"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_activation_attempts_attemptId_key" ON "fiscal_activation_attempts"("attemptId");

-- CreateIndex
CREATE INDEX "fiscal_activation_attempts_invoicyConfigId_status_idx" ON "fiscal_activation_attempts"("invoicyConfigId", "status");

-- CreateIndex
CREATE INDEX "fiscal_activation_attempts_status_leaseExpiresAt_idx" ON "fiscal_activation_attempts"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_activation_attempts_invoicyConfigId_environment_idem_key" ON "fiscal_activation_attempts"("invoicyConfigId", "environment", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_secret_migration_state_version_key" ON "fiscal_secret_migration_state"("version");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_secret_rekey_jobs_oldKeyId_newKeyId_key" ON "fiscal_secret_rekey_jobs"("oldKeyId", "newKeyId");

-- AddForeignKey
ALTER TABLE "company_environment_credentials" ADD CONSTRAINT "company_environment_credentials_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoicy_environment_configs" ADD CONSTRAINT "invoicy_environment_configs_invoicyConfigId_fkey" FOREIGN KEY ("invoicyConfigId") REFERENCES "invoicy_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoicy_config_history" ADD CONSTRAINT "invoicy_config_history_invoicyConfigId_fkey" FOREIGN KEY ("invoicyConfigId") REFERENCES "invoicy_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoicy_config_history" ADD CONSTRAINT "invoicy_config_history_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_activation_attempts" ADD CONSTRAINT "fiscal_activation_attempts_invoicyConfigId_fkey" FOREIGN KEY ("invoicyConfigId") REFERENCES "invoicy_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

