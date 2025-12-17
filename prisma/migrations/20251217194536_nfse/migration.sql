/*
  Warnings:

  - You are about to drop the column `cfop` on the `product_fiscal_data` table. All the data in the column will be lost.
  - You are about to drop the column `cofinsAliquota` on the `product_fiscal_data` table. All the data in the column will be lost.
  - You are about to drop the column `icmsAliquota` on the `product_fiscal_data` table. All the data in the column will be lost.
  - You are about to drop the column `ipiAliquota` on the `product_fiscal_data` table. All the data in the column will be lost.
  - You are about to drop the column `origem` on the `product_fiscal_data` table. All the data in the column will be lost.
  - You are about to drop the column `pisAliquota` on the `product_fiscal_data` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "NfseStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NfceStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'CONTINGENCY');

-- AlterTable
ALTER TABLE "invoicy_configs" ADD COLUMN     "accessKey" TEXT,
ADD COLUMN     "aliquotaIss" DOUBLE PRECISION,
ADD COLUMN     "codigoServico" TEXT,
ADD COLUMN     "defaultCfop" TEXT,
ADD COLUMN     "defaultOperationNature" TEXT,
ADD COLUMN     "emitIm" TEXT,
ADD COLUMN     "environment" TEXT DEFAULT 'HOMOLOGACAO',
ADD COLUMN     "partnerKey" TEXT,
ADD COLUMN     "proximoNumeroNfce" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "proximoRpsNfse" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "serieNfce" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "serieNfse" TEXT DEFAULT 'A1',
ADD COLUMN     "taxInfoText" TEXT,
ALTER COLUMN "apiToken" DROP NOT NULL,
ALTER COLUMN "emitCnpj" DROP NOT NULL,
ALTER COLUMN "emitRazaoSocial" DROP NOT NULL;

-- AlterTable
ALTER TABLE "product_fiscal_data" DROP COLUMN "cfop",
DROP COLUMN "cofinsAliquota",
DROP COLUMN "icmsAliquota",
DROP COLUMN "ipiAliquota",
DROP COLUMN "origem",
DROP COLUMN "pisAliquota",
ADD COLUMN     "cean" TEXT,
ADD COLUMN     "cfopExport" TEXT,
ADD COLUMN     "cfopInState" TEXT,
ADD COLUMN     "cfopOutState" TEXT,
ADD COLUMN     "cofinsRate" DOUBLE PRECISION,
ADD COLUMN     "icmsOrigin" TEXT,
ADD COLUMN     "icmsRate" DOUBLE PRECISION,
ADD COLUMN     "ipiRate" DOUBLE PRECISION,
ADD COLUMN     "pisRate" DOUBLE PRECISION,
ALTER COLUMN "icmsBaseModality" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "nfses" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT,
    "quotationId" TEXT,
    "numero" INTEGER NOT NULL,
    "serie" TEXT NOT NULL,
    "rpsNumero" INTEGER NOT NULL,
    "rpsSerie" TEXT NOT NULL,
    "rpsTipo" INTEGER NOT NULL DEFAULT 1,
    "codigoVerificacao" TEXT,
    "protocolo" TEXT,
    "status" "NfseStatus" NOT NULL DEFAULT 'PENDING',
    "ambiente" INTEGER NOT NULL,
    "dataEmissao" TIMESTAMP(3),
    "dataCompetencia" TIMESTAMP(3),
    "valorServicos" DOUBLE PRECISION NOT NULL,
    "valorDeducoes" DOUBLE PRECISION DEFAULT 0,
    "valorPis" DOUBLE PRECISION DEFAULT 0,
    "valorCofins" DOUBLE PRECISION DEFAULT 0,
    "valorInss" DOUBLE PRECISION DEFAULT 0,
    "valorIr" DOUBLE PRECISION DEFAULT 0,
    "valorCsll" DOUBLE PRECISION DEFAULT 0,
    "valorIss" DOUBLE PRECISION,
    "aliquotaIss" DOUBLE PRECISION,
    "baseCalculo" DOUBLE PRECISION,
    "issRetido" BOOLEAN NOT NULL DEFAULT false,
    "codigoServico" TEXT,
    "discriminacao" TEXT,
    "codigoMunicipio" TEXT,
    "xmlEnvio" TEXT,
    "xmlRetorno" TEXT,
    "pdfUrl" TEXT,
    "motivoRejeicao" TEXT,
    "motivoCancelamento" TEXT,
    "dataCancelamento" TIMESTAMP(3),
    "invoicyId" TEXT,
    "invoicyProtocol" TEXT,

    CONSTRAINT "nfses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfces" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT,
    "quotationId" TEXT,
    "numero" INTEGER NOT NULL,
    "serie" INTEGER NOT NULL,
    "chaveAcesso" TEXT,
    "protocolo" TEXT,
    "status" "NfceStatus" NOT NULL DEFAULT 'PENDING',
    "ambiente" INTEGER NOT NULL,
    "dataEmissao" TIMESTAMP(3),
    "dataAutorizacao" TIMESTAMP(3),
    "valorTotal" DOUBLE PRECISION NOT NULL,
    "valorDesconto" DOUBLE PRECISION DEFAULT 0,
    "valorTroco" DOUBLE PRECISION DEFAULT 0,
    "formaPagamento" TEXT,
    "xmlEnvio" TEXT,
    "xmlRetorno" TEXT,
    "xmlAutorizado" TEXT,
    "qrCodeUrl" TEXT,
    "urlConsulta" TEXT,
    "danfeUrl" TEXT,
    "motivoRejeicao" TEXT,
    "motivoCancelamento" TEXT,
    "dataCancelamento" TIMESTAMP(3),
    "contingencia" BOOLEAN NOT NULL DEFAULT false,
    "dataContingencia" TIMESTAMP(3),
    "motivoContingencia" TEXT,
    "invoicyId" TEXT,
    "invoicyProtocol" TEXT,

    CONSTRAINT "nfces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nfses_companyId_idx" ON "nfses"("companyId");

-- CreateIndex
CREATE INDEX "nfses_orderId_idx" ON "nfses"("orderId");

-- CreateIndex
CREATE INDEX "nfses_status_idx" ON "nfses"("status");

-- CreateIndex
CREATE INDEX "nfses_numero_serie_companyId_idx" ON "nfses"("numero", "serie", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "nfces_chaveAcesso_key" ON "nfces"("chaveAcesso");

-- CreateIndex
CREATE INDEX "nfces_companyId_idx" ON "nfces"("companyId");

-- CreateIndex
CREATE INDEX "nfces_orderId_idx" ON "nfces"("orderId");

-- CreateIndex
CREATE INDEX "nfces_status_idx" ON "nfces"("status");

-- CreateIndex
CREATE INDEX "nfces_numero_serie_companyId_idx" ON "nfces"("numero", "serie", "companyId");

-- AddForeignKey
ALTER TABLE "nfses" ADD CONSTRAINT "nfses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfses" ADD CONSTRAINT "nfses_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfses" ADD CONSTRAINT "nfses_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfces" ADD CONSTRAINT "nfces_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfces" ADD CONSTRAINT "nfces_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfces" ADD CONSTRAINT "nfces_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
