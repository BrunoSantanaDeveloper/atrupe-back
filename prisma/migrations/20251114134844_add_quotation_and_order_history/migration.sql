-- CreateTable
CREATE TABLE "quotation_history" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_history" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotation_history_quotationId_idx" ON "quotation_history"("quotationId");

-- CreateIndex
CREATE INDEX "quotation_history_createdAt_idx" ON "quotation_history"("createdAt");

-- CreateIndex
CREATE INDEX "quotation_history_createdBy_idx" ON "quotation_history"("createdBy");

-- CreateIndex
CREATE INDEX "order_history_orderId_idx" ON "order_history"("orderId");

-- CreateIndex
CREATE INDEX "order_history_createdAt_idx" ON "order_history"("createdAt");

-- CreateIndex
CREATE INDEX "order_history_createdBy_idx" ON "order_history"("createdBy");

-- AddForeignKey
ALTER TABLE "quotation_history" ADD CONSTRAINT "quotation_history_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_history" ADD CONSTRAINT "quotation_history_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_history" ADD CONSTRAINT "order_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_history" ADD CONSTRAINT "order_history_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
