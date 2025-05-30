/*
  Warnings:

  - The primary key for the `_QuotationToProduct` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `city` on the `subscriptions` table. All the data in the column will be lost.
  - You are about to drop the column `cnpj` on the `subscriptions` table. All the data in the column will be lost.
  - You are about to drop the column `cpf` on the `subscriptions` table. All the data in the column will be lost.
  - You are about to drop the column `neighborhood` on the `subscriptions` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[A,B]` on the table `_QuotationToProduct` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "_QuotationToProduct" DROP CONSTRAINT "_QuotationToProduct_AB_pkey";

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "city",
DROP COLUMN "cnpj",
DROP COLUMN "cpf",
DROP COLUMN "neighborhood";

-- CreateIndex
CREATE UNIQUE INDEX "_QuotationToProduct_AB_unique" ON "_QuotationToProduct"("A", "B");
