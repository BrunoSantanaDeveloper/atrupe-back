-- CreateEnum
CREATE TYPE "ProcessAfterBase" AS ENUM ('INHERIT', 'OWN');

-- CreateEnum
CREATE TYPE "AssemblyStatus" AS ENUM ('DRAFT', 'RELEASED', 'PART');

-- CreateEnum
CREATE TYPE "AssemblyDimension" AS ENUM ('SALE', 'FIXED');

-- CreateEnum
CREATE TYPE "AssemblyBlockType" AS ENUM ('OWN', 'PROCESS', 'PART');

-- CreateEnum
CREATE TYPE "AssemblyLineKind" AS ENUM ('MACHINE', 'MATERIAL', 'LABOR', 'OUTSOURCED');

-- CreateEnum
CREATE TYPE "AssemblyLineMode" AS ENUM ('SINGLE', 'CHOOSE', 'LIST');

-- AlterTable
ALTER TABLE "sectors" ADD COLUMN     "hourCost" INTEGER,
ADD COLUMN     "hourSale" INTEGER;

-- CreateTable
CREATE TABLE "processes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "afterBase" "ProcessAfterBase" NOT NULL DEFAULT 'INHERIT',
    "setupMinutes" INTEGER NOT NULL DEFAULT 0,
    "taskType" TEXT NOT NULL,
    "sellerInstructions" TEXT NOT NULL DEFAULT '',
    "rules" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_usual_next" (
    "id" TEXT NOT NULL,
    "fromProcessId" TEXT NOT NULL,
    "toProcessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_usual_next_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_assemblies" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variationId" TEXT,
    "variationKey" TEXT NOT NULL DEFAULT '',
    "status" "AssemblyStatus" NOT NULL DEFAULT 'DRAFT',
    "dimension" "AssemblyDimension" NOT NULL DEFAULT 'SALE',
    "allowRenameStages" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_assemblies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_blocks" (
    "id" TEXT NOT NULL,
    "assemblyId" TEXT NOT NULL,
    "type" "AssemblyBlockType" NOT NULL,
    "processId" TEXT,
    "partProductId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "sectorId" TEXT,
    "setupMinutes" INTEGER NOT NULL DEFAULT 0,
    "taskType" TEXT NOT NULL DEFAULT '',
    "rules" JSONB,
    "dependsOn" TEXT[],
    "baseBlockId" TEXT,
    "localName" TEXT,
    "localTaskType" TEXT,
    "localRules" JSONB,
    "removedSourceLineIds" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assembly_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_lines" (
    "id" TEXT NOT NULL,
    "processId" TEXT,
    "blockId" TEXT,
    "sourceLineId" TEXT,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "addedHere" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL DEFAULT '',
    "kind" "AssemblyLineKind" NOT NULL DEFAULT 'MATERIAL',
    "mode" "AssemblyLineMode" NOT NULL DEFAULT 'SINGLE',
    "formula" TEXT NOT NULL DEFAULT 'FIXED',
    "perUnit" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "lossPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minimum" DOUBLE PRECISION,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "optionalDefault" BOOLEAN NOT NULL DEFAULT true,
    "fieldName" TEXT,
    "formulaId" TEXT,
    "people" INTEGER,
    "sheetMargin" DOUBLE PRECISION,
    "sheetGap" DOUBLE PRECISION,
    "chargeWholeSheets" BOOLEAN,
    "selectedOptionId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assembly_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_line_options" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "configName" TEXT,
    "perUnit" DOUBLE PRECISION,
    "lossPercent" DOUBLE PRECISION,
    "minimum" DOUBLE PRECISION,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "assembly_line_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_fields" (
    "id" TEXT NOT NULL,
    "processId" TEXT,
    "assemblyId" TEXT,
    "name" TEXT NOT NULL,
    "defaultValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allowsFraction" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assembly_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_formulas" (
    "id" TEXT NOT NULL,
    "processId" TEXT,
    "assemblyId" TEXT,
    "name" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "sourceFormulaId" TEXT,
    "sourceProcessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assembly_formulas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "processes_companyId_isActive_idx" ON "processes"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "process_usual_next_fromProcessId_toProcessId_key" ON "process_usual_next"("fromProcessId", "toProcessId");

-- CreateIndex
CREATE INDEX "product_assemblies_companyId_idx" ON "product_assemblies"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "product_assemblies_productId_variationKey_key" ON "product_assemblies"("productId", "variationKey");

-- CreateIndex
CREATE INDEX "assembly_blocks_assemblyId_idx" ON "assembly_blocks"("assemblyId");

-- CreateIndex
CREATE INDEX "assembly_blocks_processId_idx" ON "assembly_blocks"("processId");

-- CreateIndex
CREATE INDEX "assembly_blocks_partProductId_idx" ON "assembly_blocks"("partProductId");

-- CreateIndex
CREATE INDEX "assembly_lines_processId_idx" ON "assembly_lines"("processId");

-- CreateIndex
CREATE INDEX "assembly_lines_blockId_idx" ON "assembly_lines"("blockId");

-- CreateIndex
CREATE INDEX "assembly_lines_sourceLineId_idx" ON "assembly_lines"("sourceLineId");

-- CreateIndex
CREATE INDEX "assembly_line_options_lineId_idx" ON "assembly_line_options"("lineId");

-- CreateIndex
CREATE INDEX "assembly_line_options_resourceId_idx" ON "assembly_line_options"("resourceId");

-- CreateIndex
CREATE INDEX "assembly_fields_processId_idx" ON "assembly_fields"("processId");

-- CreateIndex
CREATE INDEX "assembly_fields_assemblyId_idx" ON "assembly_fields"("assemblyId");

-- CreateIndex
CREATE INDEX "assembly_formulas_processId_idx" ON "assembly_formulas"("processId");

-- CreateIndex
CREATE INDEX "assembly_formulas_assemblyId_idx" ON "assembly_formulas"("assemblyId");

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_usual_next" ADD CONSTRAINT "process_usual_next_fromProcessId_fkey" FOREIGN KEY ("fromProcessId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_usual_next" ADD CONSTRAINT "process_usual_next_toProcessId_fkey" FOREIGN KEY ("toProcessId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_assemblies" ADD CONSTRAINT "product_assemblies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_assemblies" ADD CONSTRAINT "product_assemblies_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_assemblies" ADD CONSTRAINT "product_assemblies_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "product_variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_blocks" ADD CONSTRAINT "assembly_blocks_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "product_assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_blocks" ADD CONSTRAINT "assembly_blocks_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_blocks" ADD CONSTRAINT "assembly_blocks_partProductId_fkey" FOREIGN KEY ("partProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_blocks" ADD CONSTRAINT "assembly_blocks_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_lines" ADD CONSTRAINT "assembly_lines_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_lines" ADD CONSTRAINT "assembly_lines_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "assembly_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_line_options" ADD CONSTRAINT "assembly_line_options_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "assembly_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_fields" ADD CONSTRAINT "assembly_fields_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_fields" ADD CONSTRAINT "assembly_fields_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "product_assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_formulas" ADD CONSTRAINT "assembly_formulas_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_formulas" ADD CONSTRAINT "assembly_formulas_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "product_assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cada linha, campo e fórmula é de um processo ou de uma composição, nunca dos dois
ALTER TABLE "assembly_lines" ADD CONSTRAINT "assembly_lines_one_owner" CHECK (("processId" IS NULL) <> ("blockId" IS NULL));
ALTER TABLE "assembly_fields" ADD CONSTRAINT "assembly_fields_one_owner" CHECK (("processId" IS NULL) <> ("assemblyId" IS NULL));
ALTER TABLE "assembly_formulas" ADD CONSTRAINT "assembly_formulas_one_owner" CHECK (("processId" IS NULL) <> ("assemblyId" IS NULL));
