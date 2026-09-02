-- AlterTable
ALTER TABLE "quotations" ADD COLUMN "legacyId" TEXT;

-- CreateIndex
-- Sem esta chave a importação de vendas não era idempotente: rodar de novo
-- criava orçamentos e ordens duplicados, em vez de reconhecer os já migrados.
CREATE UNIQUE INDEX "quotations_companyId_legacyId_key" ON "quotations"("companyId", "legacyId");
