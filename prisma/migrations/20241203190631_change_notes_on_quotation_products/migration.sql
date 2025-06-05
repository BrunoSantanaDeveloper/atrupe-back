/*
  Warnings:

  - You are about to drop the column `notes` on the `quotation_product_items` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "quotation_product_items" DROP COLUMN "notes";

-- AlterTable
ALTER TABLE "quotation_products" ADD COLUMN     "notes" TEXT;
