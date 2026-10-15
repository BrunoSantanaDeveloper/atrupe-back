-- A taxa da operadora na liquidação do cartão (FC-10): a operadora baixa o
-- valor cheio, o banco recebe o líquido e a diferença é este lançamento.

-- AlterEnum
ALTER TYPE "CashMovementKind" ADD VALUE 'CARD_FEE';
