-- Caixa sem lançamento (revisão de 23/10/2026): ao abrir o dia, o caixa
-- anterior da conta que ficou aberto sem nenhum lançamento, e nunca foi
-- fechado, é fechado pelo sistema, com o fechamento igual à abertura, sem
-- quebra. Antes ele era reaproveitado como o caixa do dia novo. O campo marca
-- esse fechamento para a tela mostrar. Os caixas que já existem ficam como
-- estão (false).

-- AlterTable
ALTER TABLE "cash_registers" ADD COLUMN     "closedBySystem" BOOLEAN NOT NULL DEFAULT false;
