-- As linhas acrescentadas dentro do item do orçamento (ORC-5): processo,
-- parte do catálogo ou terceirizado avulso, com preço, custo e o retrato do
-- cálculo (ORC-10). O item guarda a soma das linhas (linesTotal), que entra
-- no valor dele por fora do desconto. E as configurações de venda da empresa,
-- com o markup do terceirizado avulso (MS-16, T-4). Tudo aditivo.

-- CreateEnum
CREATE TYPE "QuotationLineKind" AS ENUM ('PROCESS', 'PART', 'LOOSE');

-- AlterTable
ALTER TABLE "quotation_products" ADD COLUMN     "linesTotal" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "quotation_item_lines" (
    "id" TEXT NOT NULL,
    "quotationProductId" TEXT NOT NULL,
    "kind" "QuotationLineKind" NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "processId" TEXT,
    "productId" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "followsBase" BOOLEAN,
    "measure" JSONB,
    "fields" JSONB,
    "price" INTEGER NOT NULL DEFAULT 0,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "resolved" JSONB,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_item_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "outsourcedMarkup" DOUBLE PRECISION NOT NULL DEFAULT 45,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "sale_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotation_item_lines_quotationProductId_idx" ON "quotation_item_lines"("quotationProductId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_settings_companyId_key" ON "sale_settings"("companyId");

-- AddForeignKey
ALTER TABLE "quotation_item_lines" ADD CONSTRAINT "quotation_item_lines_quotationProductId_fkey" FOREIGN KEY ("quotationProductId") REFERENCES "quotation_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item_lines" ADD CONSTRAINT "quotation_item_lines_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item_lines" ADD CONSTRAINT "quotation_item_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item_lines" ADD CONSTRAINT "quotation_item_lines_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_settings" ADD CONSTRAINT "sale_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
