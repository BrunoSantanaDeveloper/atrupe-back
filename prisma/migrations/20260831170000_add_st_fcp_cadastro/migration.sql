-- Cadastro tributário de substituição tributária e Fundo de Combate à Pobreza.
--
-- São dados que o sistema não tem como derivar: a margem de valor agregado da
-- ST vem de protocolo entre estados por NCM, e a alíquota do FCP é definida por
-- lei estadual e varia por produto. Sem eles o cálculo do Regime Normal não tem
-- o que computar nessas operações.
ALTER TABLE "product_fiscal_data" ADD COLUMN IF NOT EXISTS "icmsStMva" DOUBLE PRECISION;
ALTER TABLE "product_fiscal_data" ADD COLUMN IF NOT EXISTS "icmsStReducao" DOUBLE PRECISION;
ALTER TABLE "product_fiscal_data" ADD COLUMN IF NOT EXISTS "icmsStRate" DOUBLE PRECISION;
ALTER TABLE "product_fiscal_data" ADD COLUMN IF NOT EXISTS "fcpRate" DOUBLE PRECISION;
ALTER TABLE "product_fiscal_data" ADD COLUMN IF NOT EXISTS "fcpStRate" DOUBLE PRECISION;
