-- Venda rápida e frente de caixa (Fase 7.3/7.4, módulo 5, LITE): a
-- configuração da venda rápida, o cadastro da frente de caixa, a sessão do
-- operador com os movimentos e a venda na fila do caixa. Só tabelas novas,
-- com valores em centavos.

-- CreateEnum
CREATE TYPE "QuickSalePayment" AS ENUM ('CASH_ONLY', 'POS');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashSessionMovementKind" AS ENUM ('SALE', 'WITHDRAWAL', 'SUPPLY', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PendingSaleKind" AS ENUM ('QUICK', 'QUOTATION');

-- CreateTable
CREATE TABLE "quick_sale_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payment" "QuickSalePayment" NOT NULL DEFAULT 'CASH_ONLY',
    "cashMethods" TEXT[] DEFAULT ARRAY['dinheiro', 'pix', 'cartao']::TEXT[],
    "downPaymentRequired" BOOLEAN NOT NULL DEFAULT false,
    "downPaymentPercent" INTEGER NOT NULL DEFAULT 50,
    "clientId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "seriesId" TEXT,
    "serviceTypeId" TEXT,
    "responsibleId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "quick_sale_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_fronts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Caixa 1',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "blindCount" BOOLEAN NOT NULL DEFAULT false,
    "shortageTolerance" INTEGER,
    "roundingLimit" INTEGER NOT NULL DEFAULT 100,
    "drawerAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cash_fronts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cashFrontId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "operatorId" TEXT,
    "operatorName" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "countedCash" INTEGER,
    "keep" INTEGER,
    "expected" INTEGER,
    "difference" INTEGER,
    "closingNote" TEXT,
    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_session_movements" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "CashSessionMovementKind" NOT NULL,
    "description" TEXT NOT NULL,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "discount" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "responsibleId" TEXT,
    "responsibleName" TEXT,
    "bankAccountId" TEXT,
    "pendingSaleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_session_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_sales" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "kind" "PendingSaleKind" NOT NULL DEFAULT 'QUICK',
    "path" "QuickSalePayment" NOT NULL DEFAULT 'POS',
    "total" INTEGER NOT NULL,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "goesToCash" BOOLEAN NOT NULL DEFAULT true,
    "claimedSessionId" TEXT,
    "billing" TEXT,
    "billedSessionId" TEXT,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "readyAt" TIMESTAMP(3),
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "loss" INTEGER,
    "discardedByName" TEXT,
    "discardedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parts" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "pending_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quick_sale_settings_companyId_key" ON "quick_sale_settings"("companyId");

-- CreateIndex
CREATE INDEX "cash_fronts_companyId_idx" ON "cash_fronts"("companyId");

-- CreateIndex
CREATE INDEX "cash_sessions_companyId_status_idx" ON "cash_sessions"("companyId", "status");

-- CreateIndex
CREATE INDEX "cash_session_movements_sessionId_idx" ON "cash_session_movements"("sessionId");

-- CreateIndex
CREATE INDEX "cash_session_movements_pendingSaleId_idx" ON "cash_session_movements"("pendingSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "pending_sales_quotationId_key" ON "pending_sales"("quotationId");

-- CreateIndex
CREATE INDEX "pending_sales_companyId_delivered_cancelled_idx" ON "pending_sales"("companyId", "delivered", "cancelled");

-- AddForeignKey
ALTER TABLE "quick_sale_settings" ADD CONSTRAINT "quick_sale_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_fronts" ADD CONSTRAINT "cash_fronts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cashFrontId_fkey" FOREIGN KEY ("cashFrontId") REFERENCES "cash_fronts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session_movements" ADD CONSTRAINT "cash_session_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sales" ADD CONSTRAINT "pending_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_sales" ADD CONSTRAINT "pending_sales_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
