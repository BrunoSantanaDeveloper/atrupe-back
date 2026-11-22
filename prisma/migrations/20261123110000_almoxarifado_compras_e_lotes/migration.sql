-- O almoxarifado do FULL (ES-8 a ES-17; Maicol, 22/11/2026): solicitação,
-- cotação, pedido de compra, conferência e estoque por lote, como na
-- primeira versão (VivaSign). A chave purchasing entra no catálogo e liga
-- no FULL, como sector_board (20261029210000).

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('REQUESTED', 'QUOTING', 'ORDERED', 'RECEIVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('PENDING_DELIVERY', 'CHECKING', 'FINISHED', 'CANCELED');

-- CreateEnum
CREATE TYPE "StockLotStatus" AS ENUM ('CLOSED', 'OPEN', 'FINISHED', 'CANCELED');

-- CreateEnum
CREATE TYPE "StockLotMeasure" AS ENUM ('ROLL', 'SHEET', 'UNIT');

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "materialId" TEXT,
    "variationId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "neededBy" DATE,
    "note" TEXT,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "requestedByName" TEXT NOT NULL,
    "cancelReason" TEXT,
    "orderItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_quotes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "deliveryDays" INTEGER,
    "paymentTerms" TEXT,
    "validUntil" DATE,
    "note" TEXT,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'PENDING_DELIVERY',
    "expectedAt" DATE,
    "deliveredAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "checkedByName" TEXT,
    "invoiceId" TEXT,
    "payableId" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestId" TEXT,
    "materialId" TEXT,
    "variationId" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "receivedQuantity" DOUBLE PRECISION,
    "divergence" TEXT,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT,
    "orderId" TEXT,
    "text" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "supplierName" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "measure" "StockLotMeasure" NOT NULL DEFAULT 'UNIT',
    "cost" INTEGER NOT NULL DEFAULT 0,
    "quantity" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION,
    "length" DOUBLE PRECISION,
    "currentQuantity" DOUBLE PRECISION NOT NULL,
    "currentWidth" DOUBLE PRECISION,
    "currentLength" DOUBLE PRECISION,
    "status" "StockLotStatus" NOT NULL DEFAULT 'CLOSED',
    "openedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "parentId" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lot_events" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "byName" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lot_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_requests_companyId_status_idx" ON "purchase_requests"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_companyId_number_key" ON "purchase_requests"("companyId", "number");

-- CreateIndex
CREATE INDEX "purchase_quotes_requestId_idx" ON "purchase_quotes"("requestId");

-- CreateIndex
CREATE INDEX "purchase_orders_companyId_status_idx" ON "purchase_orders"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_companyId_number_key" ON "purchase_orders"("companyId", "number");

-- CreateIndex
CREATE INDEX "purchase_order_items_orderId_idx" ON "purchase_order_items"("orderId");

-- CreateIndex
CREATE INDEX "purchase_events_requestId_idx" ON "purchase_events"("requestId");

-- CreateIndex
CREATE INDEX "purchase_events_orderId_idx" ON "purchase_events"("orderId");

-- CreateIndex
CREATE INDEX "stock_lots_companyId_status_idx" ON "stock_lots"("companyId", "status");

-- CreateIndex
CREATE INDEX "stock_lots_stockItemId_idx" ON "stock_lots"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_companyId_number_key" ON "stock_lots"("companyId", "number");

-- CreateIndex
CREATE INDEX "stock_lot_events_lotId_idx" ON "stock_lot_events"("lotId");

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_quotes" ADD CONSTRAINT "purchase_quotes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_events" ADD CONSTRAINT "purchase_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_events" ADD CONSTRAINT "purchase_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_events" ADD CONSTRAINT "stock_lot_events_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "features" (
  "id", "key", "name", "description", "category", "price", "isActive", "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid()::text,
  'purchasing',
  'Compras e lotes',
  'Solicitação de material, cotação, pedido de compra com conferência e o estoque por lote',
  'stock',
  0,
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

WITH "alvo" AS (
  SELECT
    p."id" AS "planId",
    p."planType"::text AS "planType",
    p."name" AS "planName",
    f."id" AS "featureId",
    f."name" AS "featureName"
  FROM "plans" p
  CROSS JOIN "features" f
  WHERE f."key" = 'purchasing'
    AND p."companyId" IS NULL
    AND p."planType"::text IN ('FULL')
    AND NOT EXISTS (
      SELECT 1
      FROM "plan_features" pf
      WHERE pf."planId" = p."id"
        AND pf."featureId" = f."id"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "plan_config_history" h
      WHERE h."planId" = p."id"
        AND h."entityType" = 'PLAN_FEATURE'
        AND h."featureKey" = 'purchasing'
    )
),
"ligado" AS (
  INSERT INTO "plan_features" ("id", "planId", "featureId", "isActive", "createdAt")
  SELECT gen_random_uuid()::text, a."planId", a."featureId", true, NOW()
  FROM "alvo" a
  RETURNING "planId"
)
INSERT INTO "plan_config_history" (
  "id",
  "entityType",
  "planId",
  "planType",
  "featureKey",
  "action",
  "description",
  "changes",
  "metadata",
  "createdByName",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  'PLAN_FEATURE',
  a."planId",
  a."planType",
  'purchasing',
  'ENABLED',
  '"' || a."featureName" || '" incluído no plano ' || a."planName"
    || ' — Compras e lotes no FULL (ES-8 a ES-17, 22/11/2026)',
  jsonb_build_object(
    'before', jsonb_build_object('enabled', false),
    'after', jsonb_build_object('enabled', true)
  ),
  jsonb_build_object(
    'source', 'MIGRATION',
    'migration', '20261123110000_almoxarifado_compras_e_lotes'
  ),
  'Migração 2026-11',
  NOW()
FROM "alvo" a
JOIN "ligado" l ON l."planId" = a."planId";
