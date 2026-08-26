-- CreateTable
CREATE TABLE "nfse_servicos" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "aliquotaIss" DOUBLE PRECISION,
    "codTribMunicipio" TEXT,
    "cnae" TEXT,
    "nbs" TEXT,
    "codTribNacional" TEXT,
    "codClassificacao" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "nfse_servicos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nfse_servicos_companyId_idx" ON "nfse_servicos"("companyId");

-- AddForeignKey
ALTER TABLE "nfse_servicos" ADD CONSTRAINT "nfse_servicos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
