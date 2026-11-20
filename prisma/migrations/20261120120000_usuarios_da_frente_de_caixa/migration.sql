-- Quem pode abrir e movimentar cada frente de caixa (Lista Lite 19/11,
-- item 2). Vazia: todos com a permissão da frente de caixa, como antes.
ALTER TABLE "cash_fronts" ADD COLUMN "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
