-- AlterTable
ALTER TABLE "products" ADD COLUMN "legacyId" TEXT;

-- CreateIndex
-- O produto é casado pelo código, que é único por empresa. Numa conta que já
-- estava em uso, o código do legado pode pertencer a um produto que o cliente
-- cadastrou: sem esta coluna não há como saber qual produto veio da migração,
-- e a carga sobrescrevia o do cliente.
CREATE UNIQUE INDEX "products_companyId_legacyId_key" ON "products"("companyId", "legacyId");
