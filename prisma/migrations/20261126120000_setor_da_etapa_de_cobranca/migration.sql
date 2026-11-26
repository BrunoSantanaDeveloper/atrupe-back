-- O setor da etapa de cobrança (área 9 §4.16; Maicol, 26/11/2026): cada
-- unidade de venda do produto aponta o setor em que é feita, e esse setor é
-- um ícone fixo do fluxo de produção.
ALTER TABLE "product_items" ADD COLUMN "sectorId" TEXT;
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_sectorId_fkey"
  FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Os produtos que já existem: a unidade recebe o setor de mesmo nome que já
-- está ativo no fluxo do produto. O que não casar fica como ícone livre.
UPDATE "product_items" AS pi
SET "sectorId" = s."id"
FROM "products" AS p,
     LATERAL jsonb_array_elements(
       CASE jsonb_typeof(p."productionStages"::jsonb)
         WHEN 'array' THEN p."productionStages"::jsonb
         -- gravado como texto JSON por versões antigas
         WHEN 'string' THEN (p."productionStages"::jsonb #>> '{}')::jsonb
         ELSE '[]'::jsonb END
     ) AS stage,
     "sectors" AS s
WHERE pi."productId" = p."id"
  AND pi."sectorId" IS NULL
  AND s."id" = stage->>'id'
  AND s."companyId" = p."companyId"
  AND COALESCE((stage->>'isActive')::boolean, true)
  AND lower(trim(s."name")) = lower(trim(pi."name"));

-- O produto de uma unidade só: a unidade recebe o setor do produto, quando
-- ele está ativo no fluxo.
UPDATE "product_items" AS pi
SET "sectorId" = p."sectorId"
FROM "products" AS p
WHERE pi."productId" = p."id"
  AND pi."sectorId" IS NULL
  AND p."sectorId" IS NOT NULL
  AND (SELECT COUNT(*) FROM "product_items" x WHERE x."productId" = p."id") = 1
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE jsonb_typeof(p."productionStages"::jsonb)
        WHEN 'array' THEN p."productionStages"::jsonb
        WHEN 'string' THEN (p."productionStages"::jsonb #>> '{}')::jsonb
        ELSE '[]'::jsonb END
    ) AS stage
    WHERE stage->>'id' = p."sectorId"
      AND COALESCE((stage->>'isActive')::boolean, true)
  );

-- O ícone que veio da etapa de cobrança não sai do pedido na agenda
ALTER TABLE "production_item_stages" ADD COLUMN "fixed" BOOLEAN NOT NULL DEFAULT false;
