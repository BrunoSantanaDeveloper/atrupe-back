-- O troco dado em cada recebimento (FC-2), para o comprovante a pedido
-- (FC-16).

-- AlterTable
ALTER TABLE "cash_session_movements" ADD COLUMN     "change" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "pending_sales" ADD COLUMN     "change" INTEGER NOT NULL DEFAULT 0;
