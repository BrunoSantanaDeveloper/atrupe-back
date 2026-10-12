-- O item do orçamento guarda a origem, a variação escolhida, a composição
-- escolhida pelo vendedor, o retrato da composição na venda (ORC-10) e o
-- acréscimo em centavos (ALT-25). Tudo aditivo: os itens existentes ficam
-- como produto do cadastro, sem variação e sem acréscimo.

-- CreateEnum
CREATE TYPE "QuotationItemOrigin" AS ENUM ('PRODUCT', 'COMPOSED', 'MATERIAL');

-- AlterTable
ALTER TABLE "quotation_products" ADD COLUMN     "addition" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "composition" JSONB,
ADD COLUMN     "origin" "QuotationItemOrigin" NOT NULL DEFAULT 'PRODUCT',
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "variationId" TEXT;

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "product_variations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
