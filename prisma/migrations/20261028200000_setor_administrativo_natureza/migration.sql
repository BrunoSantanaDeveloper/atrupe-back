-- A migração de 12/10/2026 acertou a natureza dos setores que já existiam,
-- mas a empresa criada depois disso recebia Administração e Comercial com a
-- natureza padrão (produtiva): o cadastro de empresa não a informava. Esses
-- setores entravam na Distribuição e na base de custos como produtivos.
-- Mesmo acerto daquela migração, com o que a troca para administrativo faz
-- no setor: rateio de volta ao padrão e sem percentual de distribuição (BC-7).
--
-- Só as empresas criadas depois que a migração de 12/10 rodou no homolog
-- (15/10/2026 00:42 UTC). As de antes já tinham a natureza certa, e o setor
-- delas que hoje está produtivo foi trocado de propósito: a natureza é
-- editável, e o acerto apagaria o rateio escolhido. Em produção a migração
-- de 12/10 roda no mesmo deploy desta, então lá não sobra nada a acertar.
UPDATE "sectors"
SET "nature" = 'ADMINISTRATIVE',
    "allocationCriterion" = 'ACQUISITION_VALUE',
    "allocationPercentages" = NULL,
    "allocationPreviousCriterion" = NULL,
    "allocationOutdated" = false,
    "distributionPercentage" = 0
WHERE "kind" = 'ADMINISTRATIVE'
  AND "nature" = 'PRODUCTIVE'
  AND "companyId" IN (
    SELECT "id" FROM "companies" WHERE "createdAt" >= '2026-10-15 00:42:44'
  );
