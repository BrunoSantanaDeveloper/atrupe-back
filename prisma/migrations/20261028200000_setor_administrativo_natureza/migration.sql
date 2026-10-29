-- A migração de 12/10/2026 acertou a natureza dos setores que já existiam,
-- mas a empresa criada depois disso recebia Administração e Comercial com a
-- natureza padrão (produtiva): o cadastro de empresa não a informava. Esses
-- setores entravam na Distribuição e na base de custos como produtivos.
-- Mesmo acerto daquela migração, com o que a troca para administrativo faz
-- no setor: rateio de volta ao padrão e sem percentual de distribuição (BC-7).
UPDATE "sectors"
SET "nature" = 'ADMINISTRATIVE',
    "allocationCriterion" = 'ACQUISITION_VALUE',
    "allocationPercentages" = NULL,
    "allocationPreviousCriterion" = NULL,
    "allocationOutdated" = false,
    "distributionPercentage" = 0
WHERE "kind" = 'ADMINISTRATIVE' AND "nature" = 'PRODUCTIVE';
