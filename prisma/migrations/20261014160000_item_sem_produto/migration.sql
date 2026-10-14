-- Item do orçamento sem produto (Fase 4.4 e 4.5, decisões do PO de 14/10/2026):
-- o material de venda direta (origin MATERIAL) e o item montado na hora
-- (origin COMPOSED) não têm produto do cadastro.

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "fiscal" JSONB;

-- AlterTable
ALTER TABLE "quotation_products" ADD COLUMN     "materialId" TEXT,
ADD COLUMN     "materialVariationId" TEXT,
ADD COLUMN     "unitPrice" INTEGER,
ALTER COLUMN "productId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_materialVariationId_fkey" FOREIGN KEY ("materialVariationId") REFERENCES "material_variations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
