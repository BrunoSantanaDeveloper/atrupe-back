-- Acompanhamento comercial do orçamento (revisão de 24/10/2026): o próximo
-- contato com o cliente, com data e nota. É o que alimenta a lista
-- "para retomar hoje" na tela de orçamentos.

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "nextContactAt" TIMESTAMP(3),
ADD COLUMN     "nextContactNote" TEXT;
