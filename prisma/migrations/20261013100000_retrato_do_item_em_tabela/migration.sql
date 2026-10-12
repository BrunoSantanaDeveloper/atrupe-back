-- O retrato da venda do item (ORC-10) sai da linha do item para uma tabela
-- própria. Os includes do orçamento (O.S., fiscal, PDF) e as respostas de
-- add-product/update-product devolvem a linha inteira do item, e o retrato
-- tem custo (ORC-7): em tabela própria, ele só sai quando pedido.

-- CreateTable
CREATE TABLE "quotation_item_snapshots" (
    "quotationProductId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_item_snapshots_pkey" PRIMARY KEY ("quotationProductId")
);

-- Os retratos já gravados vão junto
INSERT INTO "quotation_item_snapshots" ("quotationProductId", "data")
SELECT "id", "snapshot" FROM "quotation_products" WHERE "snapshot" IS NOT NULL;

-- AlterTable
ALTER TABLE "quotation_products" DROP COLUMN "snapshot";

-- AddForeignKey
ALTER TABLE "quotation_item_snapshots" ADD CONSTRAINT "quotation_item_snapshots_quotationProductId_fkey" FOREIGN KEY ("quotationProductId") REFERENCES "quotation_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
