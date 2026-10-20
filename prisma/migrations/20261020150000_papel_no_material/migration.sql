-- Papéis no LITE (decisão do PO de 13/10/2026): o papel é um material com a
-- forma "folha" (shape SHEET). Ganha a gramatura (g/m²), o formato da folha
-- (o padrão preenche sheetWidth × sheetHeight; o personalizado leva a medida)
-- e a área útil em mm (vazia = a folha inteira). Tudo opcional: o material
-- que já existe fica como está.

-- CreateEnum
CREATE TYPE "SheetFormat" AS ENUM ('A4', 'A3', 'SRA3', 'A3_PLUS', 'CUSTOM');

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "grammage" INTEGER,
ADD COLUMN     "sheetFormat" "SheetFormat",
ADD COLUMN     "usableHeight" DOUBLE PRECISION,
ADD COLUMN     "usableWidth" DOUBLE PRECISION;
