-- A estrutura do produto (18/11/2026): define quais blocos o cadastro abre.
-- Os produtos que já existem: terceirizado vira OUTSOURCED; com papel em
-- alguma variação, SHEET; o resto fica STANDARD.
CREATE TYPE "ProductStructure" AS ENUM ('STANDARD', 'SHEET', 'OFFSET', 'RENTAL', 'OUTSOURCED');

ALTER TABLE "products" ADD COLUMN "structure" "ProductStructure" NOT NULL DEFAULT 'STANDARD';

UPDATE "products" SET "structure" = 'OUTSOURCED' WHERE "isOutsourced" = true;

UPDATE "products" p SET "structure" = 'SHEET'
WHERE p."isOutsourced" = false
  AND EXISTS (
    SELECT 1 FROM "product_variations" v
    WHERE v."productId" = p."id" AND v."paperId" IS NOT NULL
  );
