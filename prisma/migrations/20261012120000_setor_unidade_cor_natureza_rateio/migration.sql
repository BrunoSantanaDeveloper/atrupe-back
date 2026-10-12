-- O setor ganha de uma vez os campos que três módulos pedem (plano de
-- 10/10/2026, seção 7.0), para a tabela não ser alterada três vezes:
--   saleUnit   como o setor vende: hora ou a unidade do equipamento (composição)
--   color      #RRGGBB em maiúsculas; nulo = padrão do ícone, resolvido na tela
--   nature     produtivo ou administrativo (base de custos)
--   allocation* rateio entre os equipamentos do setor (base de custos)
--
-- Só acrescenta colunas, todas com padrão ou nulas: o código que está no ar
-- continua funcionando sem conhecê-las.

-- CreateEnum
CREATE TYPE "SectorSaleUnit" AS ENUM ('HOUR', 'M2', 'M', 'UN', 'KM');

-- CreateEnum
CREATE TYPE "SectorNature" AS ENUM ('ADMINISTRATIVE', 'PRODUCTIVE');

-- CreateEnum
CREATE TYPE "SectorAllocationCriterion" AS ENUM ('ACQUISITION_VALUE', 'ACTIVITY_TIME', 'MANUAL');

-- AlterTable
ALTER TABLE "sectors" ADD COLUMN     "allocationCriterion" "SectorAllocationCriterion" NOT NULL DEFAULT 'ACQUISITION_VALUE',
ADD COLUMN     "allocationOutdated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "allocationPercentages" JSONB,
ADD COLUMN     "allocationPreviousCriterion" "SectorAllocationCriterion",
ADD COLUMN     "color" TEXT,
ADD COLUMN     "nature" "SectorNature" NOT NULL DEFAULT 'PRODUCTIVE',
ADD COLUMN     "saleUnit" "SectorSaleUnit" NOT NULL DEFAULT 'HOUR';

-- A natureza parte do tipo que o setor já tem: o cadastro padrão classifica
-- Administração e Comercial como ADMINISTRATIVE e o resto como produção. Os
-- setores de sistema (Entrega, Cliente Retira) ficam produtivos, como o padrão.
UPDATE "sectors" SET "nature" = 'ADMINISTRATIVE' WHERE "kind" = 'ADMINISTRATIVE';
