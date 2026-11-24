-- Refazer a O.S. (GP-51), revisão de 24/11/2026: a execução reservada de
-- forma atômica (EXECUTING), para dois cliques em Aprovar não gerarem duas
-- cópias; o pedido que parou no meio fica FAILED, com o motivo, e não barra
-- pedidos novos; o motivo do cancelamento da O.S. antiga, escolhido no
-- pedido. Só tipo e colunas que aceitam vazio: nenhum dado existente muda.
ALTER TYPE "OrderRedoStatus" ADD VALUE 'EXECUTING';
ALTER TYPE "OrderRedoStatus" ADD VALUE 'FAILED';

ALTER TABLE "order_redos" ADD COLUMN "cancelReasonId" TEXT;
ALTER TABLE "order_redos" ADD COLUMN "failReason" TEXT;
