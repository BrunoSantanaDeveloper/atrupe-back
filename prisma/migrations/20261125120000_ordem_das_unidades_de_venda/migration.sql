-- A ordem das unidades de venda do produto (Lista Lite 24/11, item 3): saíam
-- por nome. As que já existem ficam na ordem de hoje (por nome); as gravadas
-- daqui em diante seguem a ordem do cadastro.
ALTER TABLE "product_items" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "product_items" AS pi
SET "position" = ordered.rn - 1
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "productId" ORDER BY "name", "id") AS rn
  FROM "product_items"
) AS ordered
WHERE pi."id" = ordered."id";
