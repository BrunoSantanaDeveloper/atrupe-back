/*
  Warnings:

  - The primary key for the `quotation_product_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `quotationProductId` on the `quotation_product_items` table. All the data in the column will be lost.
  - Added the required column `productId` to the `quotation_product_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quotationId` to the `quotation_product_items` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "quotation_product_items" DROP CONSTRAINT "quotation_product_items_quotationProductId_fkey";

-- DropIndex
DROP INDEX "quotation_products_productId_key";

-- AlterTable
ALTER TABLE "quotation_product_items" DROP CONSTRAINT "quotation_product_items_pkey",
DROP COLUMN "quotationProductId",
ADD COLUMN     "productId" TEXT NOT NULL,
ADD COLUMN     "quotationId" TEXT NOT NULL,
ADD CONSTRAINT "quotation_product_items_pkey" PRIMARY KEY ("quotationId", "productId", "productItemId");

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_quotationId_productId_fkey" FOREIGN KEY ("quotationId", "productId") REFERENCES "quotation_products"("quotationId", "productId") ON DELETE RESTRICT ON UPDATE CASCADE;
