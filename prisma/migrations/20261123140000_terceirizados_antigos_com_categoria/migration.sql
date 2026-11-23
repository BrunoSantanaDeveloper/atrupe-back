-- Terceirizados antigos sem natureza e categoria (Lista Lite 19/11, LL-10;
-- decisão do Maicol, 23/11/2026: ainda não há clientes usando, corrigir em
-- lote). Os novos já nascem com Operacional › Terceirizados de O.S.; aqui as
-- contas a pagar de terceirizado (financialType OUTSOURCED) sem natureza
-- recebem a mesma, pela mesma regra do quotation-workflow
-- (outsourcedCategories): a natureza de despesa (level1 02) que tem a
-- categoria "Terceirizados de O.S." ou, sem ela, a 02.02.01; a categoria
-- pelo nome ou, sem ele, a de código 03. Só preenche o que está vazio.

WITH nature_pick AS (
  SELECT DISTINCT ON (p."companyId")
    p."companyId",
    n.id AS "natureId"
  FROM "payables" p
  JOIN "natures" n
    ON n."companyId" = p."companyId"
   AND n."isActive" = true
   AND n."level1" = '02'
  WHERE p."financialType" = 'OUTSOURCED'
    AND p."natureId" IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM "sub_categories" s
        WHERE s."natureId" = n.id
          AND s."isActive" = true
          AND lower(s."description") = lower('Terceirizados de O.S.')
      )
      OR (n."level2" = '02' AND n."code" = '01')
    )
  ORDER BY
    p."companyId",
    -- a que tem a categoria pelo nome vem antes da 02.02.01
    (EXISTS (
      SELECT 1 FROM "sub_categories" s
      WHERE s."natureId" = n.id
        AND s."isActive" = true
        AND lower(s."description") = lower('Terceirizados de O.S.')
    )) DESC,
    n."createdAt" ASC
),
category_pick AS (
  SELECT DISTINCT ON (np."companyId")
    np."companyId",
    np."natureId",
    s.id AS "subCategoryId"
  FROM nature_pick np
  LEFT JOIN "sub_categories" s
    ON s."natureId" = np."natureId"
   AND s."companyId" = np."companyId"
   AND s."isActive" = true
   AND (lower(s."description") = lower('Terceirizados de O.S.') OR s."code" = '03')
  ORDER BY
    np."companyId",
    (lower(s."description") = lower('Terceirizados de O.S.')) DESC NULLS LAST,
    s."createdAt" ASC
)
UPDATE "payables" p
SET "natureId" = c."natureId",
    "subCategoryId" = COALESCE(p."subCategoryId", c."subCategoryId")
FROM category_pick c
WHERE p."companyId" = c."companyId"
  AND p."financialType" = 'OUTSOURCED'
  AND p."natureId" IS NULL;
