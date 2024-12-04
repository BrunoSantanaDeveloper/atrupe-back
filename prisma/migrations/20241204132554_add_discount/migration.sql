/*
  Warnings:

  - You are about to drop the column `discount` on the `quotation_product_items` table. All the data in the column will be lost.
  - You are about to drop the column `discountType` on the `quotation_product_items` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "quotation_product_items" DROP COLUMN "discount",
DROP COLUMN "discountType";

-- AlterTable
ALTER TABLE "quotation_products" ADD COLUMN     "discount" DOUBLE PRECISION,
ADD COLUMN     "discountType" TEXT;
