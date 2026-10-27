-- Quantidade mínima do produto (27/10/2026), na unidade comercial (0,5 m²,
-- 3 un): abaixo dela o item é cobrado pelo mínimo; por unidade, o item nasce
-- com ela
ALTER TABLE "products" ADD COLUMN "minQuantity" DOUBLE PRECISION;
