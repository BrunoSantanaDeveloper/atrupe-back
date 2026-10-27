-- Venda mínima por item da empresa (27/10/2026), em centavos: abaixo dela o
-- item do orçamento é cobrado pelo mínimo; 0 = sem mínimo
ALTER TABLE "sale_settings" ADD COLUMN "minItemValue" INTEGER NOT NULL DEFAULT 0;
