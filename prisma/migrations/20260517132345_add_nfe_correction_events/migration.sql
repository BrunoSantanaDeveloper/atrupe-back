-- CreateEnum
CREATE TYPE "FiscalOnboardingStatus" AS ENUM ('PENDING', 'PROVISIONING', 'ACTIVE', 'PENDING_REVIEW', 'REJECTED');

-- AlterTable
ALTER TABLE "payment_conditions" DROP COLUMN "invoiceType",
ADD COLUMN     "invoiceType" "InvoiceType";

-- DropTable
DROP TABLE "_backup_items_corrompidos_ml";

-- DropTable
DROP TABLE "_backup_product_items_ml";

-- DropTable
DROP TABLE "_backup_products_corrompidos_ml";

-- DropTable
DROP TABLE "_backup_products_vinil_ml";

-- DropTable
DROP TABLE "_backup_quotation_product_items_ml";

-- CreateTable
CREATE TABLE "nfe_correction_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nfeId" TEXT NOT NULL,
    "sequenciaEvento" INTEGER NOT NULL,
    "correcao" TEXT NOT NULL,
    "protocolo" TEXT,
    "dataEvento" TIMESTAMP(3),

    CONSTRAINT "nfe_correction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_onboarding_requests" (
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

-- CreateIndex
CREATE INDEX "nfe_correction_events_nfeId_idx" ON "nfe_correction_events"("nfeId");

-- CreateIndex
CREATE INDEX "fiscal_onboarding_requests_companyId_idx" ON "fiscal_onboarding_requests"("companyId");

-- CreateIndex
CREATE INDEX "fiscal_onboarding_requests_status_idx" ON "fiscal_onboarding_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "academy_progress_companyId_academySystemId_key" ON "academy_progress"("companyId", "academySystemId");

-- AddForeignKey
ALTER TABLE "nfe_correction_events" ADD CONSTRAINT "nfe_correction_events_nfeId_fkey" FOREIGN KEY ("nfeId") REFERENCES "nfes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_onboarding_requests" ADD CONSTRAINT "fiscal_onboarding_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

