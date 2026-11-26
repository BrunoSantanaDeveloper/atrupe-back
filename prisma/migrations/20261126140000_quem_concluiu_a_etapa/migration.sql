-- Quem concluiu a etapa do item e quando (área 9 §4.16; Maicol, 26/11/2026):
-- a lista de trabalhos do LITE e a Agenda de entrega gravam ao concluir.
ALTER TABLE "production_item_stages" ADD COLUMN "doneAt" TIMESTAMP(3);
ALTER TABLE "production_item_stages" ADD COLUMN "doneById" TEXT;
ALTER TABLE "production_item_stages" ADD COLUMN "doneByName" TEXT;
