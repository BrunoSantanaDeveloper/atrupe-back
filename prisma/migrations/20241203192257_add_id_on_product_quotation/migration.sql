/*
  Warnings:

  - The primary key for the `quotation_product_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `quotation_products` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The required column `id` was added to the `quotation_product_items` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `quotationProductId` to the `quotation_product_items` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `quotation_products` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- DropForeignKey
ALTER TABLE "quotation_product_items" DROP CONSTRAINT "quotation_product_items_quotationId_productId_fkey";

-- AlterTable
ALTER TABLE "quotation_product_items" DROP CONSTRAINT "quotation_product_items_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "quotationProductId" TEXT NOT NULL,
ADD CONSTRAINT "quotation_product_items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "quotation_products" DROP CONSTRAINT "quotation_products_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "quotation_products_pkey" PRIMARY KEY ("id");

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_quotationProductId_fkey" FOREIGN KEY ("quotationProductId") REFERENCES "quotation_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
