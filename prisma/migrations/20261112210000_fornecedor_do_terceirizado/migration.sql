-- O fornecedor do produto terceirizado escolhido no item (12/11/2026)
ALTER TABLE "quotation_products" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
