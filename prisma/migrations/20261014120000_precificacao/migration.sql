-- Precificação (módulo 4, fatia 5.4): os parâmetros da empresa (PR-4) e a
-- regra, o preço e o lucro da hora do setor, da configuração produtiva e do
-- grupo de bens equivalentes. Tudo novo, com o padrão de hoje (preço fixo).

-- AlterTable
ALTER TABLE "sectors" ADD COLUMN     "hourSaleProfit" INTEGER,
ADD COLUMN     "hourSaleRule" "MaterialPriceRule" NOT NULL DEFAULT 'FIXED';

-- AlterTable
ALTER TABLE "asset_groups" ADD COLUMN     "priceRule" "MaterialPriceRule" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "profit" INTEGER,
ADD COLUMN     "salePrice" INTEGER;

-- AlterTable
ALTER TABLE "asset_setups" ADD COLUMN     "priceRule" "MaterialPriceRule" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "profit" INTEGER,
ADD COLUMN     "salePrice" INTEGER;

-- CreateTable
CREATE TABLE "pricing_parameters" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxation" INTEGER NOT NULL DEFAULT 0,
    "commission" INTEGER NOT NULL DEFAULT 0,
    "financialCost" INTEGER NOT NULL DEFAULT 0,
    "desiredMargin" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_parameters_companyId_key" ON "pricing_parameters"("companyId");

