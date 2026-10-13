-- Base de custos (módulo 4, fatia 5.3): o percentual do total administrativo
-- que cada setor produtivo recebe (BC-5), o critério e o rateio por item de
-- cada conta administrativa (DC-17, BC-8) e as horas de cada colaborador no
-- mês (F-11). Tudo novo; nada muda nos dados que já existem.

-- CreateEnum
CREATE TYPE "CostCriterion" AS ENUM ('LAST_MONTH', 'AVG_3', 'AVG_6', 'AVG_12', 'MANUAL');

-- AlterTable
ALTER TABLE "sectors" ADD COLUMN     "distributionPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "cost_base_expenses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "subCategoryId" TEXT NOT NULL,
    "criterion" "CostCriterion",
    "manualValue" INTEGER,
    "allocations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_base_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_workloads" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_workloads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_base_expenses_companyId_subCategoryId_key" ON "cost_base_expenses"("companyId", "subCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_workloads_employeeId_key" ON "employee_workloads"("employeeId");

-- CreateIndex
CREATE INDEX "employee_workloads_companyId_idx" ON "employee_workloads"("companyId");

