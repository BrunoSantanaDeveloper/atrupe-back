-- CreateEnum
CREATE TYPE "NfeStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'CORRECTION_SENT');

-- CreateTable
CREATE TABLE "invoicy_configs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "ambiente" INTEGER NOT NULL DEFAULT 2,
    "emitCnpj" TEXT NOT NULL,
    "emitIe" TEXT,
    "emitRazaoSocial" TEXT NOT NULL,
    "emitNomeFantasia" TEXT,
    "emitCrt" INTEGER NOT NULL DEFAULT 1,
    "emitEndereco" TEXT,
    "emitNumero" TEXT,
    "emitBairro" TEXT,
    "emitCep" TEXT,
    "emitCmun" TEXT,
    "emitUf" TEXT,
    "emitPais" TEXT DEFAULT '1058',
    "serieNfe" INTEGER NOT NULL DEFAULT 1,
    "proximoNumeroNfe" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "invoicy_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfes" (
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
    "status" "NfeStatus" NOT NULL DEFAULT 'PENDING',
    "ambiente" INTEGER NOT NULL,
    "dataEmissao" TIMESTAMP(3),
    "dataAutorizacao" TIMESTAMP(3),
    "valorTotal" DOUBLE PRECISION NOT NULL,
    "xmlEnvio" TEXT,
    "xmlRetorno" TEXT,
    "xmlAutorizado" TEXT,
    "danfeUrl" TEXT,
    "motivoRejeicao" TEXT,
    "motivoCancelamento" TEXT,
    "dataCancelamento" TIMESTAMP(3),
    "cartaCorrecao" TEXT,
    "dataCorrecao" TIMESTAMP(3),
    "invoicyId" TEXT,
    "invoicyProtocol" TEXT,

    CONSTRAINT "nfes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_fiscal_data" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ncm" TEXT,
    "cest" TEXT,
    "cfop" TEXT,
    "productCode" TEXT,
    "commercialUnit" TEXT,
    "origem" INTEGER,
    "icmsCst" TEXT,
    "icmsAliquota" DOUBLE PRECISION,
    "icmsReducao" DOUBLE PRECISION,
    "icmsCreditRate" DOUBLE PRECISION,
    "icmsBaseModality" INTEGER,
    "pisCst" TEXT,
    "pisAliquota" DOUBLE PRECISION,
    "cofinsCst" TEXT,
    "cofinsAliquota" DOUBLE PRECISION,
    "ipiCst" TEXT,
    "ipiAliquota" DOUBLE PRECISION,
    "ipiFramework" TEXT,

    CONSTRAINT "product_fiscal_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoicy_configs_companyId_key" ON "invoicy_configs"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "nfes_chaveAcesso_key" ON "nfes"("chaveAcesso");

-- CreateIndex
CREATE INDEX "nfes_companyId_idx" ON "nfes"("companyId");

-- CreateIndex
CREATE INDEX "nfes_orderId_idx" ON "nfes"("orderId");

-- CreateIndex
CREATE INDEX "nfes_status_idx" ON "nfes"("status");

-- CreateIndex
CREATE INDEX "nfes_numero_serie_companyId_idx" ON "nfes"("numero", "serie", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "product_fiscal_data_productId_key" ON "product_fiscal_data"("productId");

-- AddForeignKey
ALTER TABLE "invoicy_configs" ADD CONSTRAINT "invoicy_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfes" ADD CONSTRAINT "nfes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfes" ADD CONSTRAINT "nfes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfes" ADD CONSTRAINT "nfes_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_fiscal_data" ADD CONSTRAINT "product_fiscal_data_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
