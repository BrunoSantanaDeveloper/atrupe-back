-- CreateEnum (idempotent)
DO $$ BEGIN
    CREATE TYPE "FiscalOnboardingStatus" AS ENUM ('PENDING', 'PROVISIONING', 'ACTIVE', 'PENDING_REVIEW', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable (idempotent: drop if exists, add if not exists)
ALTER TABLE "payment_conditions" DROP COLUMN IF EXISTS "invoiceType";
ALTER TABLE "payment_conditions" ADD COLUMN IF NOT EXISTS "invoiceType" "InvoiceType";

-- DropTable (idempotent)
DROP TABLE IF EXISTS "_backup_items_corrompidos_ml";
DROP TABLE IF EXISTS "_backup_product_items_ml";
DROP TABLE IF EXISTS "_backup_products_corrompidos_ml";
DROP TABLE IF EXISTS "_backup_products_vinil_ml";
DROP TABLE IF EXISTS "_backup_quotation_product_items_ml";

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "nfe_correction_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nfeId" TEXT NOT NULL,
    "sequenciaEvento" INTEGER NOT NULL,
    "correcao" TEXT NOT NULL,
    "protocolo" TEXT,
    "dataEvento" TIMESTAMP(3),

    CONSTRAINT "nfe_correction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "fiscal_onboarding_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "FiscalOnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "ie" TEXT,
    "im" TEXT,
    "cnae" TEXT,
    "uf" TEXT NOT NULL,
    "codigoIbge" TEXT,
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "complemento" TEXT,
    "invoicyAccessKey" TEXT,
    "invoicyCryptoKey" TEXT,
    "errorMessage" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "fiscal_onboarding_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "nfe_correction_events_nfeId_idx" ON "nfe_correction_events"("nfeId");
CREATE INDEX IF NOT EXISTS "fiscal_onboarding_requests_companyId_idx" ON "fiscal_onboarding_requests"("companyId");
CREATE INDEX IF NOT EXISTS "fiscal_onboarding_requests_status_idx" ON "fiscal_onboarding_requests"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "academy_progress_companyId_academySystemId_key" ON "academy_progress"("companyId", "academySystemId");

-- AddForeignKey (idempotent via DO block)
DO $$ BEGIN
    ALTER TABLE "nfe_correction_events" ADD CONSTRAINT "nfe_correction_events_nfeId_fkey"
        FOREIGN KEY ("nfeId") REFERENCES "nfes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "fiscal_onboarding_requests" ADD CONSTRAINT "fiscal_onboarding_requests_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

