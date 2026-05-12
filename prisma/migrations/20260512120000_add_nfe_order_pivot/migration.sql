-- CreateTable
CREATE TABLE "nfe_orders" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nfeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "nfe_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nfe_orders_nfeId_orderId_key" ON "nfe_orders"("nfeId", "orderId");

-- CreateIndex
CREATE INDEX "nfe_orders_orderId_idx" ON "nfe_orders"("orderId");

-- AddForeignKey
ALTER TABLE "nfe_orders" ADD CONSTRAINT "nfe_orders_nfeId_fkey" FOREIGN KEY ("nfeId") REFERENCES "nfes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfe_orders" ADD CONSTRAINT "nfe_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing one-to-one links into the pivot.
INSERT INTO "nfe_orders" ("id", "nfeId", "orderId")
SELECT gen_random_uuid()::text, "id", "orderId"
FROM "nfes"
WHERE "orderId" IS NOT NULL;
