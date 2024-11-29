/*
  Warnings:

  - A unique constraint covering the columns `[number,companyId]` on the table `invoices` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[code,companyId]` on the table `products` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[name,companyId]` on the table `seller_profile` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "invoices_number_key";

-- DropIndex
DROP INDEX "products_code_key";

-- DropIndex
DROP INDEX "roles_name_key";

-- DropIndex
DROP INDEX "seller_profile_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_companyId_key" ON "invoices"("number", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_companyId_key" ON "products"("code", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "seller_profile_name_companyId_key" ON "seller_profile"("name", "companyId");
