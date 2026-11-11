-- Nota avulsa em digitação.
--
-- Sair da tela perdia tudo: nenhuma das telas avulsas (NF-e, NFS-e, NFC-e)
-- gravava rascunho, e a NFC-e nem tem o status DRAFT no enum. O rascunho fica
-- em tabela própria porque não é documento fiscal — e porque em "nfces" seria
-- impossível: o unique de (empresa, número, série, ambiente) faria dois
-- rascunhos colidirem entre si ou com a numeração de uma emissão futura.
CREATE TABLE IF NOT EXISTS "fiscal_standalone_drafts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docType" "FiscalDocType" NOT NULL,
    "description" TEXT,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_standalone_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "fiscal_standalone_drafts_companyId_docType_idx" ON "fiscal_standalone_drafts"("companyId", "docType");
CREATE INDEX IF NOT EXISTS "fiscal_standalone_drafts_companyId_updatedAt_idx" ON "fiscal_standalone_drafts"("companyId", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_standalone_drafts_companyId_fkey'
  ) THEN
    ALTER TABLE "fiscal_standalone_drafts" ADD CONSTRAINT "fiscal_standalone_drafts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
