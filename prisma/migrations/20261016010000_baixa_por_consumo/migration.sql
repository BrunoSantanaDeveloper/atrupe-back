-- A baixa por consumo (ES-7): o movimento guarda a venda, e a baixa da
-- mesma venda não se repete.

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "quotationId" TEXT;

-- CreateIndex
CREATE INDEX "stock_movements_quotationId_idx" ON "stock_movements"("quotationId");
