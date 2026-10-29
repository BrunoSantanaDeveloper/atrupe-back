-- A venda mínima por item (27/10/2026) sai (decisão de 29/10/2026): a
-- quantidade mínima do produto e o valor mínimo do pedido já cobrem o caso.
ALTER TABLE "sale_settings" DROP COLUMN "minItemValue";
