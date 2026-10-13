-- Patrimônios do módulo 4 (base de custos): o bem ganha tipo, nível
-- (detalhado ou simplificado), unidade, produtividade, aquisição, vida útil,
-- residual, situação e venda; nascem os grupos de bens equivalentes, os
-- custos e as configurações produtivas do bem, o histórico das escritas de
-- custo (SEG-4) e as marcas da base por empresa. As colunas antigas ficam
-- (sem tela) e os bens que já existiam ganham os valores nelas guardados.

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('MACHINES', 'FURNITURE', 'VEHICLES');

-- CreateEnum
CREATE TYPE "AssetUnit" AS ENUM ('HR', 'M2', 'M', 'KM', 'UN', 'KG', 'LT');

-- CreateEnum
CREATE TYPE "AssetCostNature" AS ENUM ('FIXED', 'MACHINE_VARIABLE', 'SETUP_VARIABLE');

-- CreateEnum
CREATE TYPE "AssetYieldUnit" AS ENUM ('MONTH', 'UNIT');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "acquisitionDate" DATE,
ADD COLUMN     "acquisitionValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "detailed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "inactivatedAt" TIMESTAMP(3),
ADD COLUMN     "inactiveReason" TEXT,
ADD COLUMN     "kind" "AssetKind" NOT NULL DEFAULT 'MACHINES',
ADD COLUMN     "monthlyProductivity" DOUBLE PRECISION,
ADD COLUMN     "residualPercent" DOUBLE PRECISION,
ADD COLUMN     "saleReceivableId" TEXT,
ADD COLUMN     "saleResult" INTEGER,
ADD COLUMN     "saleValue" INTEGER,
ADD COLUMN     "soldAt" TIMESTAMP(3),
ADD COLUMN     "unit" "AssetUnit",
ADD COLUMN     "usefulLifeMonths" INTEGER,
ADD COLUMN     "usefulLifeReviewedAt" TIMESTAMP(3),
ALTER COLUMN "purchaseValue" DROP NOT NULL,
ALTER COLUMN "residualValue" DROP NOT NULL,
ALTER COLUMN "usefulLife" DROP NOT NULL;

-- Os bens que já existiam: aquisição e residual em centavos, como o resto do
-- sistema; a vida útil antiga vai como meses (conferir em produção: o campo
-- não tinha unidade documentada)
UPDATE "assets" SET
  "acquisitionValue" = COALESCE(ROUND("purchaseValue")::integer, 0),
  "residualPercent" = CASE
    WHEN "purchaseValue" > 0 AND "residualValue" IS NOT NULL
      THEN ROUND(("residualValue" / "purchaseValue" * 100)::numeric, 2)::double precision
  END,
  "usefulLifeMonths" = CASE WHEN "usefulLife" > 0 THEN "usefulLife" END
WHERE "purchaseValue" IS NOT NULL;

-- CreateTable
CREATE TABLE "asset_groups" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "AssetUnit" NOT NULL,
    "sectorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_costs" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nature" "AssetCostNature" NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "yieldAmount" DOUBLE PRECISION NOT NULL,
    "yieldUnit" "AssetYieldUnit" NOT NULL,
    "subCategoryId" TEXT,
    "lastOccurrence" DATE,
    "setupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_setups" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL DEFAULT '',
    "unit" "AssetUnit" NOT NULL,
    "timePerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyProductivity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_setups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_audit_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_base_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetGroupsSeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_base_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_groups_companyId_name_key" ON "asset_groups"("companyId", "name");

-- CreateIndex
CREATE INDEX "asset_costs_assetId_idx" ON "asset_costs"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_setups_assetId_name_key" ON "asset_setups"("assetId", "name");

-- CreateIndex
CREATE INDEX "cost_audit_logs_companyId_entity_entityId_idx" ON "cost_audit_logs"("companyId", "entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "cost_base_settings_companyId_key" ON "cost_base_settings"("companyId");

-- CreateIndex
CREATE INDEX "assets_companyId_active_idx" ON "assets"("companyId", "active");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "asset_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_groups" ADD CONSTRAINT "asset_groups_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_groups" ADD CONSTRAINT "asset_groups_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_costs" ADD CONSTRAINT "asset_costs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_costs" ADD CONSTRAINT "asset_costs_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_costs" ADD CONSTRAINT "asset_costs_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "asset_setups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_setups" ADD CONSTRAINT "asset_setups_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
