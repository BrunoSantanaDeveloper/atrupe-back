-- Chaves novas na tela de cargos (decisões do PO, 14/10), sem ninguém perder
-- acesso na virada. Só dados; nenhuma coluna muda.

-- Composição por etapas, processos e recursos (D18): quem via produtos passa
-- a ver a composição; quem editava produtos passa a editá-la
UPDATE "roles"
SET "permissions" = array_append("permissions", 'product_settings:composition:view')
WHERE 'product_settings:products:view' = ANY("permissions")
  AND NOT ('product_settings:composition:view' = ANY("permissions"));

UPDATE "roles"
SET "permissions" = array_append("permissions", 'product_settings:composition:edit')
WHERE 'product_settings:products:edit' = ANY("permissions")
  AND NOT ('product_settings:composition:edit' = ANY("permissions"));

-- Origens de contato: a API aceitava qualquer configuração de vendas para
-- criar, editar e excluir; quem tinha alguma recebe as quatro ações
UPDATE "roles"
SET "permissions" = "permissions" || ARRAY[
  'sales_settings:contact_sources:view',
  'sales_settings:contact_sources:create',
  'sales_settings:contact_sources:edit',
  'sales_settings:contact_sources:delete'
]
WHERE EXISTS (
    SELECT 1 FROM unnest("permissions") AS p
    WHERE p LIKE 'sales_settings:%'
      AND p NOT LIKE 'sales_settings:contact_sources:%'
  )
  AND NOT ('sales_settings:contact_sources:view' = ANY("permissions"));
