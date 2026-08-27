-- AlterTable
ALTER TABLE "payment_conditions" ADD COLUMN "legacyId" TEXT;

-- CreateIndex
-- O legado repete nomes de condição ("À prazo" com 5,00% e com 3,90%), e a
-- importação casava por nome pegando o primeiro resultado.
CREATE UNIQUE INDEX "payment_conditions_companyId_legacyId_key" ON "payment_conditions"("companyId", "legacyId");
