-- AlterTable
ALTER TABLE "employees" ADD COLUMN "legacyId" TEXT,
ADD COLUMN "isImported" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
-- Chave de vínculo com o sistema legado. NULLs não conflitam no Postgres, então
-- colaboradores cadastrados manualmente (sem legacyId) continuam livres de restrição.
CREATE UNIQUE INDEX "employees_companyId_legacyId_key" ON "employees"("companyId", "legacyId");
