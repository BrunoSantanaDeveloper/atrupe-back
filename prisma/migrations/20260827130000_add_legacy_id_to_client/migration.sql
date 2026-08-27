-- AlterTable
ALTER TABLE "clients" ADD COLUMN "legacyId" TEXT;

-- CreateIndex
-- Chave alternativa de vínculo: 29% dos clientes do legado não têm CPF/CNPJ, e
-- o documento era a única forma de achar o cliente na importação de vendas.
CREATE UNIQUE INDEX "clients_companyId_legacyId_key" ON "clients"("companyId", "legacyId");
