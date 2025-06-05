-- DropForeignKey
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_seriesId_fkey";

-- AlterTable
ALTER TABLE "quotations" ALTER COLUMN "seriesId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "quotation_products" (
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "quotation_products_pkey" PRIMARY KEY ("quotationId","productId")
);

-- CreateTable
CREATE TABLE "_QuotationToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_QuotationToProduct_AB_unique" ON "_QuotationToProduct"("A", "B");

-- CreateIndex
CREATE INDEX "_QuotationToProduct_B_index" ON "_QuotationToProduct"("B");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "sale_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_products" ADD CONSTRAINT "quotation_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuotationToProduct" ADD CONSTRAINT "_QuotationToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QuotationToProduct" ADD CONSTRAINT "_QuotationToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
