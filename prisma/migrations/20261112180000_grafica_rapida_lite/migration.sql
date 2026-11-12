-- Gráfica rápida no LITE (12/11/2026): sangria variável e folhas de acerto
-- (setor, produto e item)
ALTER TABLE "sectors"
  ADD COLUMN "bleedMm" DOUBLE PRECISION,
  ADD COLUMN "setupSheets" INTEGER;

ALTER TABLE "products"
  ADD COLUMN "bleedMm" DOUBLE PRECISION,
  ADD COLUMN "setupSheets" INTEGER;

ALTER TABLE "quotation_products" ADD COLUMN "printSpec" JSONB;
