/*
  Warnings:

  - A unique constraint covering the columns `[productId]` on the table `quotation_products` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "quotation_products" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "quotation_product_items" (
    "quotationProductId" TEXT NOT NULL,
    "productItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "quotation_product_items_pkey" PRIMARY KEY ("quotationProductId","productItemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotation_products_productId_key" ON "quotation_products"("productId");

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_quotationProductId_fkey" FOREIGN KEY ("quotationProductId") REFERENCES "quotation_products"("productId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "product_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
