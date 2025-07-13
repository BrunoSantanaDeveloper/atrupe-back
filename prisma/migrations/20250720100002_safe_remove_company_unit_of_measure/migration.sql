-- Migration SEGURA para remover CompanyUnitOfMeasure
-- Com verificações de integridade e possibilidade de rollback

-- PASSO 1: Verificações de segurança
DO $$
DECLARE
    orphan_count INTEGER;
    missing_defaults INTEGER;
    missing_codes INTEGER;
BEGIN
    -- Verificar se há CompanyUnits sem defaultUnitOfMeasureId que não têm código correspondente
    SELECT COUNT(*) INTO orphan_count
    FROM "unit_measures" cum
    LEFT JOIN "defalt_unit_measures" dum ON cum.code = dum.code
    WHERE cum."defaultUnitOfMeasureId" IS NULL AND dum.id IS NULL;
    
    IF orphan_count > 0 THEN
        RAISE EXCEPTION 'ERRO: Existem % unidades sem correspondência em DefaultUnitOfMeasure. Migration cancelada por segurança.', orphan_count;
    END IF;
    
    RAISE NOTICE 'Verificação de segurança passou. Iniciando migration...';
END $$;

-- PASSO 2: Criar tabela de backup para rollback
CREATE TABLE IF NOT EXISTS "unit_measures_backup" AS 
SELECT * FROM "unit_measures";

-- PASSO 3: Adicionar colunas temporárias
ALTER TABLE "product_items" ADD COLUMN IF NOT EXISTS "temp_unit_id" TEXT;
ALTER TABLE "quotation_product_items" ADD COLUMN IF NOT EXISTS "temp_unit_id" TEXT;

-- PASSO 4: Migrar dados com verificação
-- Para ProductItems
UPDATE "product_items" pi 
SET "temp_unit_id" = COALESCE(
    cum."defaultUnitOfMeasureId",
    (SELECT dum.id FROM "defalt_unit_measures" dum WHERE dum.code = cum.code LIMIT 1)
)
FROM "unit_measures" cum 
WHERE pi."unitOfMeasureId" = cum.id;

-- Para QuotationProductItems  
UPDATE "quotation_product_items" qpi 
SET "temp_unit_id" = COALESCE(
    cum."defaultUnitOfMeasureId",
    (SELECT dum.id FROM "defalt_unit_measures" dum WHERE dum.code = cum.code LIMIT 1)
)
FROM "unit_measures" cum 
WHERE qpi."unitOfMeasureId" = cum.id;

-- PASSO 5: Verificar se todas as migrações foram bem-sucedidas
DO $$
DECLARE
    null_product_items INTEGER;
    null_quotation_items INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_product_items FROM "product_items" WHERE "temp_unit_id" IS NULL;
    SELECT COUNT(*) INTO null_quotation_items FROM "quotation_product_items" WHERE "temp_unit_id" IS NULL;
    
    IF null_product_items > 0 OR null_quotation_items > 0 THEN
        RAISE EXCEPTION 'ERRO: Migration falhou - há registros com temp_unit_id NULL. ProductItems: %, QuotationItems: %', 
            null_product_items, null_quotation_items;
    END IF;
    
    RAISE NOTICE 'Migração de dados concluída com sucesso.';
END $$;

-- PASSO 6: Remover constraints antigas
ALTER TABLE "product_items" DROP CONSTRAINT IF EXISTS "product_items_unitOfMeasureId_fkey";
ALTER TABLE "quotation_product_items" DROP CONSTRAINT IF EXISTS "quotation_product_items_unitOfMeasureId_fkey";

-- PASSO 7: Trocar colunas
ALTER TABLE "product_items" DROP COLUMN "unitOfMeasureId";
ALTER TABLE "product_items" RENAME COLUMN "temp_unit_id" TO "unitOfMeasureId";

ALTER TABLE "quotation_product_items" DROP COLUMN "unitOfMeasureId";  
ALTER TABLE "quotation_product_items" RENAME COLUMN "temp_unit_id" TO "unitOfMeasureId";

-- PASSO 8: Adicionar novas constraints
ALTER TABLE "product_items" 
    ADD CONSTRAINT "product_items_unitOfMeasureId_fkey" 
    FOREIGN KEY ("unitOfMeasureId") REFERENCES "defalt_unit_measures"("id") 
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quotation_product_items" 
    ADD CONSTRAINT "quotation_product_items_unitOfMeasureId_fkey" 
    FOREIGN KEY ("unitOfMeasureId") REFERENCES "defalt_unit_measures"("id") 
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- PASSO 9: Validação final
DO $$
DECLARE
    invalid_refs INTEGER;
BEGIN
    -- Verificar se todas as referências são válidas
    SELECT COUNT(*) INTO invalid_refs
    FROM "product_items" pi
    LEFT JOIN "defalt_unit_measures" dum ON pi."unitOfMeasureId" = dum.id
    WHERE dum.id IS NULL;
    
    IF invalid_refs > 0 THEN
        RAISE EXCEPTION 'ERRO: Há % referências inválidas em ProductItems após migration!', invalid_refs;
    END IF;
    
    SELECT COUNT(*) INTO invalid_refs
    FROM "quotation_product_items" qpi  
    LEFT JOIN "defalt_unit_measures" dum ON qpi."unitOfMeasureId" = dum.id
    WHERE dum.id IS NULL;
    
    IF invalid_refs > 0 THEN
        RAISE EXCEPTION 'ERRO: Há % referências inválidas em QuotationProductItems após migration!', invalid_refs;
    END IF;
    
    RAISE NOTICE 'Validação final passou. Migration concluída com sucesso!';
END $$;

-- PASSO 10: Só remove a tabela original após tudo validado
DROP TABLE "unit_measures";

-- PASSO 11: Remove backup após confirmação (opcional - manter por segurança)
-- DROP TABLE "unit_measures_backup"; 