/*
  Warnings:

  - A unique constraint covering the columns `[code,companyId]` on the table `sale_series` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "sale_series_code_key";

-- CreateIndex
CREATE UNIQUE INDEX "sale_series_code_companyId_key" ON "sale_series"("code", "companyId");
