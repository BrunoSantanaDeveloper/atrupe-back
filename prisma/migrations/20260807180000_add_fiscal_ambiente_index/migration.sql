-- A listagem unificada (GET /fiscal/nfe/unified) passou a filtrar por ambiente
-- dentro da empresa. Sem estes índices o filtro vira scan por companyId.
--
-- O unique de nfces (companyId, numero, serie, ambiente) não atende: numero e
-- serie vêm antes de ambiente na ordem das colunas.

CREATE INDEX IF NOT EXISTS "nfes_companyId_ambiente_idx" ON "nfes"("companyId", "ambiente");
CREATE INDEX IF NOT EXISTS "nfses_companyId_ambiente_idx" ON "nfses"("companyId", "ambiente");
CREATE INDEX IF NOT EXISTS "nfces_companyId_ambiente_idx" ON "nfces"("companyId", "ambiente");
