-- As etapas de cada item do pedido na Agenda de entrega (área 9 §4.7;
-- Maicol, 23/11/2026). A etapa do pedido do mesmo setor passa a ser o
-- resumo das etapas dos itens. Pedidos antigos ficam sem: o item segue as
-- etapas da ordem, como antes.
CREATE TABLE "production_item_stages" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "quotationProductId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductionStageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "prevStatus" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "production_item_stages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "production_item_stages_scheduleId_idx" ON "production_item_stages"("scheduleId");
CREATE INDEX "production_item_stages_quotationProductId_idx" ON "production_item_stages"("quotationProductId");

ALTER TABLE "production_item_stages" ADD CONSTRAINT "production_item_stages_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "delivery_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_item_stages" ADD CONSTRAINT "production_item_stages_quotationProductId_fkey" FOREIGN KEY ("quotationProductId") REFERENCES "quotation_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_item_stages" ADD CONSTRAINT "production_item_stages_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
