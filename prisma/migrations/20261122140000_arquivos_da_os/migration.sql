-- Os arquivos da O.S. (GP-49, 22/11/2026): guardados na O.S. geral; vê quem
-- vê a O.S.; contam no espaço dos arquivos e entram na limpeza.
CREATE TABLE "order_files" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "order_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_files_orderId_idx" ON "order_files"("orderId");
CREATE INDEX "order_files_companyId_idx" ON "order_files"("companyId");

ALTER TABLE "order_files" ADD CONSTRAINT "order_files_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
