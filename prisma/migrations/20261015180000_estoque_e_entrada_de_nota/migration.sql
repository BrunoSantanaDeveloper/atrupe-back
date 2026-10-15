-- Estoque e entrada de nota (Fase 7.5, módulo 5, FULL): o saldo por
-- material e variação com o custo médio, os movimentos com a origem, a nota
-- de entrada com os itens do fornecedor e o de-para por fornecedor. Valores
-- em centavos; quantidades na unidade do material.

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('ENTRY', 'CONSUMPTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InboundInvoiceStatus" AS ENUM ('PENDING', 'MATCHED', 'ENTERED');

-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "variationId" TEXT,
    "key" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minimum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageCost" INTEGER NOT NULL DEFAULT 0,
    "lastEntryCost" INTEGER,
    "lastEntryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" INTEGER,
    "origin" TEXT NOT NULL,
    "invoiceId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "series" TEXT,
    "accessKey" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierDocument" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "total" INTEGER NOT NULL,
    "status" "InboundInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "enteredAt" TIMESTAMP(3),
    "enteredById" TEXT,
    "enteredByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_invoice_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplierUnit" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitValue" INTEGER NOT NULL,
    "gtin" TEXT,
    "materialId" TEXT,
    "variationId" TEXT,
    "conversionFactor" DOUBLE PRECISION,

    CONSTRAINT "inbound_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_item_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierKey" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "variationId" TEXT,
    "conversionFactor" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_item_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_companyId_key_key" ON "stock_items"("companyId", "key");

-- CreateIndex
CREATE INDEX "stock_movements_companyId_date_idx" ON "stock_movements"("companyId", "date");

-- CreateIndex
CREATE INDEX "stock_movements_invoiceId_idx" ON "stock_movements"("invoiceId");

-- CreateIndex
CREATE INDEX "inbound_invoices_companyId_status_idx" ON "inbound_invoices"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_invoices_companyId_accessKey_key" ON "inbound_invoices"("companyId", "accessKey");

-- CreateIndex
CREATE INDEX "inbound_invoice_items_invoiceId_idx" ON "inbound_invoice_items"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_item_links_companyId_supplierKey_supplierCode_key" ON "supplier_item_links"("companyId", "supplierKey", "supplierCode");

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "material_variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_invoices" ADD CONSTRAINT "inbound_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_invoice_items" ADD CONSTRAINT "inbound_invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "inbound_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_item_links" ADD CONSTRAINT "supplier_item_links_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
