/*
  Warnings:

  - You are about to drop the column `configurations` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `cost` on the `assets` table. All the data in the column will be lost.
  - Added the required column `purchaseValue` to the `assets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `residualValue` to the `assets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `usefulLife` to the `assets` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "assets" DROP CONSTRAINT "assets_companyId_fkey";

-- AlterTable
ALTER TABLE "assets" DROP COLUMN "configurations",
DROP COLUMN "cost",
ADD COLUMN     "costGroupId" INTEGER,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "fixedMonthlyCost" DOUBLE PRECISION,
ADD COLUMN     "purchaseValue" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "residualValue" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "sectorId" TEXT,
ADD COLUMN     "typeId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3),
ADD COLUMN     "usefulLife" INTEGER NOT NULL,
ADD COLUMN     "variableQualityMonthlyCost" DOUBLE PRECISION,
ADD COLUMN     "variableTotalMonthlyCost" DOUBLE PRECISION,
ALTER COLUMN "companyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "asset_types" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "details" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "asset_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
