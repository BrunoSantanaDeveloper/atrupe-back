-- Refazer a O.S. (GP-51; Maicol, 23/11/2026): o pedido, a aprovação de um
-- segundo nível quando já houve produção, a O.S. nova ligada à antiga e o
-- excedente produzido (perda ou cobrado do cliente).
CREATE TYPE "OrderRedoExcess" AS ENUM ('CLIENT', 'COMPANY');
CREATE TYPE "OrderRedoStatus" AS ENUM ('PENDING_APPROVAL', 'EXECUTED', 'REJECTED');

CREATE TABLE "order_redos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "oldQuotationId" TEXT NOT NULL,
    "newQuotationId" TEXT,
    "reason" TEXT NOT NULL,
    "excess" "OrderRedoExcess" NOT NULL DEFAULT 'COMPANY',
    "status" "OrderRedoStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "produced" JSONB,
    "requestedById" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "rejectReason" TEXT,
    "carriedAt" TIMESTAMP(3),
    "carried" INTEGER NOT NULL DEFAULT 0,
    "lossItems" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "order_redos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_redos_companyId_status_idx" ON "order_redos"("companyId", "status");
CREATE INDEX "order_redos_orderId_idx" ON "order_redos"("orderId");
CREATE INDEX "order_redos_newQuotationId_idx" ON "order_redos"("newQuotationId");
