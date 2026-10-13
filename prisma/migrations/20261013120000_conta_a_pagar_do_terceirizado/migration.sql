-- O custo do terceirizado avulso acrescentado no item vira conta a pagar ao
-- fornecedor quando a venda é aprovada (T-3). Tipo financeiro próprio, para
-- não contar como o financeiro da venda (receber e pagar no pedido).

-- AlterEnum
ALTER TYPE "FinancialType" ADD VALUE 'OUTSOURCED';
