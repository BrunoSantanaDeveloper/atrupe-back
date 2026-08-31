-- Regra de substituição tributária por UF de destino.
--
-- A MVA-ST e a alíquota interna são definidas por protocolo entre estados e
-- variam por destino, então uma única MVA no produto não atende quem vende para
-- todo o país. Sem linha para a UF, o cálculo usa os campos de ST do próprio
-- product_fiscal_data como padrão.
CREATE TABLE IF NOT EXISTS "product_st_rules" (
  "id"              TEXT NOT NULL,
  "productId"       TEXT NOT NULL,
  "ufDestino"       TEXT NOT NULL,
  "mva"             DOUBLE PRECISION,
  "aliquotaInterna" DOUBLE PRECISION,
  "reducaoBase"     DOUBLE PRECISION,
  "fcpStRate"       DOUBLE PRECISION,
  CONSTRAINT "product_st_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_st_rules_productId_ufDestino_key"
  ON "product_st_rules"("productId", "ufDestino");
CREATE INDEX IF NOT EXISTS "product_st_rules_productId_idx"
  ON "product_st_rules"("productId");

ALTER TABLE "product_st_rules"
  ADD CONSTRAINT "product_st_rules_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
