-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "legacyId" TEXT;

-- CreateIndex
-- 22 dos 25 fornecedores da base piloto não têm CPF/CNPJ, então a deduplicação
-- por documento não os protegia: reimportar duplicaria a base.
CREATE UNIQUE INDEX "suppliers_companyId_legacyId_key" ON "suppliers"("companyId", "legacyId");
