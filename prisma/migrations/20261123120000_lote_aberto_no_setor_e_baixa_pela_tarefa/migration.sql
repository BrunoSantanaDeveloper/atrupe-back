-- O lote aberto vai para um setor e a baixa do impressor vale para o
-- estoque (ES-16; Maicol, 22/11/2026): o movimento guarda o lote, a tarefa
-- e o material vendido que ele substitui.
ALTER TABLE "stock_lots" ADD COLUMN "sectorId" TEXT;
ALTER TABLE "stock_lots" ADD COLUMN "sectorName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "stock_movements" ADD COLUMN "lotId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "taskId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "replacesKey" TEXT;
CREATE INDEX "stock_movements_lotId_idx" ON "stock_movements"("lotId");
