-- Parametrização do IBS/CBS por emissor.
--
-- O grupo de valores do IBS/CBS é opcional no layout do provedor (ocorrência
-- 0-1) e o retorno da recepção de RPS não devolve esses valores — quem informa
-- é o emitente. Como a exigência varia por município, o envio começa desligado
-- e é habilitado emissor a emissor.
--
-- A alíquota do IBS municipal é definida por cada município; por isso mora no
-- emissor e não numa constante nacional.
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "ibsCbsEnviarValores" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "regApIbsCbsSn" INTEGER;
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "aliquotaIbsUf" DOUBLE PRECISION;
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "aliquotaIbsMun" DOUBLE PRECISION;
ALTER TABLE "invoicy_configs" ADD COLUMN IF NOT EXISTS "aliquotaCbs" DOUBLE PRECISION;
