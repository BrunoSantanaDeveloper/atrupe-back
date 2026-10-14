-- Item montado na hora (Fase 4.5, ORC-11): o rascunho de composição ligado
-- ao orçamento. A composição passa a ter dois donos possíveis, o produto ou
-- o rascunho; o produto salvo do item montado nasce sem código (PO, 14/10).

-- AlterTable
ALTER TABLE "product_assemblies" ADD COLUMN     "draftId" TEXT,
ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "code" DROP NOT NULL;

-- AlterTable
ALTER TABLE "quotation_products" ADD COLUMN     "draftId" TEXT;

-- CreateTable
CREATE TABLE "quotation_drafts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Item composto',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotation_drafts_quotationId_idx" ON "quotation_drafts"("quotationId");

-- CreateIndex
CREATE INDEX "quotation_drafts_companyId_createdAt_idx" ON "quotation_drafts"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_assemblies_draftId_key" ON "product_assemblies"("draftId");

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "quotation_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_assemblies" ADD CONSTRAINT "product_assemblies_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "quotation_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_drafts" ADD CONSTRAINT "quotation_drafts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_drafts" ADD CONSTRAINT "quotation_drafts_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Toda composição tem um dono só: o produto ou o rascunho
ALTER TABLE "product_assemblies" ADD CONSTRAINT "product_assemblies_one_owner"
  CHECK (("productId" IS NULL) <> ("draftId" IS NULL));
