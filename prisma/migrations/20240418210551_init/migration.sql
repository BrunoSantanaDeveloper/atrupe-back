/*
  Warnings:

  - You are about to drop the `Language` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UnitOfMeasure` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Language" DROP CONSTRAINT "Language_companyId_fkey";

-- DropForeignKey
ALTER TABLE "UnitOfMeasure" DROP CONSTRAINT "UnitOfMeasure_companyId_fkey";

-- DropForeignKey
ALTER TABLE "product_items" DROP CONSTRAINT "product_items_unitOfMeasureId_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_unitOfMeasureId_fkey";

-- DropTable
DROP TABLE "Language";

-- DropTable
DROP TABLE "UnitOfMeasure";

-- CreateTable
CREATE TABLE "unit_measures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "unit_measures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "languages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "languages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_measures_code_key" ON "unit_measures"("code");

-- CreateIndex
CREATE UNIQUE INDEX "languages_code_key" ON "languages"("code");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unitOfMeasureId_fkey" FOREIGN KEY ("unitOfMeasureId") REFERENCES "unit_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_unitOfMeasureId_fkey" FOREIGN KEY ("unitOfMeasureId") REFERENCES "unit_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_measures" ADD CONSTRAINT "unit_measures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "languages" ADD CONSTRAINT "languages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
