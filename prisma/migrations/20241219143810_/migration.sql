/*
  Warnings:

  - Added the required column `companyId` to the `unit_measures` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UnitOfMeasureKind" AS ENUM ('LENGTH', 'WEIGHT', 'CAPACITY');

-- AlterTable
ALTER TABLE "unit_measures" ADD COLUMN     "companyId" TEXT NOT NULL,
ADD COLUMN     "defaultUnitOfMeasureId" TEXT,
ADD COLUMN     "kind" TEXT;

-- CreateTable
CREATE TABLE "defalt_unit_measures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "defalt_unit_measures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "defalt_unit_measures_code_key" ON "defalt_unit_measures"("code");

-- AddForeignKey
ALTER TABLE "unit_measures" ADD CONSTRAINT "unit_measures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_measures" ADD CONSTRAINT "unit_measures_defaultUnitOfMeasureId_fkey" FOREIGN KEY ("defaultUnitOfMeasureId") REFERENCES "defalt_unit_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
