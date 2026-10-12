-- Materiais do PRO (contrato da API, módulo 1, parte B): o insumo, as
-- variações marca × cor e o de-para aprendido na importação de lista.
--
-- Só cria tabelas e tipos novos: o código que está no ar não as conhece.
-- Dinheiro em centavos inteiros (política das tabelas novas); medidas em mm.

-- CreateEnum
CREATE TYPE "MaterialUnit" AS ENUM ('HR', 'M2', 'M', 'KM', 'UN', 'KG', 'LT');

-- CreateEnum
CREATE TYPE "MaterialPriceRule" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "MaterialShape" AS ENUM ('PROFILE', 'SHEET', 'OTHER');

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "searchName" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL DEFAULT '',
    "unit" "MaterialUnit" NOT NULL,
    "directSale" BOOLEAN NOT NULL DEFAULT false,
    "productionMaterial" BOOLEAN NOT NULL DEFAULT true,
    "priceRule" "MaterialPriceRule" NOT NULL DEFAULT 'FIXED',
    "cost" INTEGER,
    "price" INTEGER,
    "desiredMargin" INTEGER,
    "costUpdatedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "shape" "MaterialShape",
    "profileX" DOUBLE PRECISION,
    "profileY" DOUBLE PRECISION,
    "barLength" DOUBLE PRECISION,
    "sheetWidth" DOUBLE PRECISION,
    "sheetHeight" DOUBLE PRECISION,
    "wholeSheets" BOOLEAN NOT NULL DEFAULT true,
    "weight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_variations" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "cost" INTEGER,
    "price" INTEGER,
    "desiredMargin" INTEGER,
    "costUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_import_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalName" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_import_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "materials_companyId_active_idx" ON "materials"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "materials_companyId_number_key" ON "materials"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "material_variations_materialId_matchKey_key" ON "material_variations"("materialId", "matchKey");

-- CreateIndex
CREATE UNIQUE INDEX "material_import_links_companyId_externalName_key" ON "material_import_links"("companyId", "externalName");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_variations" ADD CONSTRAINT "material_variations_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_import_links" ADD CONSTRAINT "material_import_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_import_links" ADD CONSTRAINT "material_import_links_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
