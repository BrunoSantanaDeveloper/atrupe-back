-- "Zerar dados da conta" pelo superadmin: o registro de cada execução, com o
-- resumo do que saiu e a cópia de segurança das linhas apagadas por um prazo.
CREATE TABLE IF NOT EXISTS "company_data_resets" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "backup" BYTEA,
    "backupExpiresAt" TIMESTAMP(3),
    CONSTRAINT "company_data_resets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "company_data_resets_companyId_createdAt_idx" ON "company_data_resets"("companyId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_data_resets_companyId_fkey'
  ) THEN
    ALTER TABLE "company_data_resets" ADD CONSTRAINT "company_data_resets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
