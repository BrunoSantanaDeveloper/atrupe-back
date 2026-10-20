-- Papéis no LITE (decisão do PO de 13/10/2026): o padrão de medida ganha o
-- tipo "folha" (A4, A3, SRA3, A3+ e personalizada). Só o valor do enum: as
-- unidades da folha entram na migration seguinte, porque o valor novo só pode
-- ser usado depois de gravado.

-- AlterEnum
ALTER TYPE "UnitKind" ADD VALUE 'SHEET';
