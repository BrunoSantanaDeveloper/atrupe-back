/*
  Warnings:

  - The `billing` column on the `sale_series` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `productionStatus` column on the `sale_series` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `sendToProduction` column on the `sale_series` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "BiilingKind" AS ENUM ('ON_ORDER', 'ON_DELIVERY', 'ON_CHECKOUT');

-- CreateEnum
CREATE TYPE "SendToProductionKind" AS ENUM ('DIRECT');

-- CreateEnum
CREATE TYPE "ProductionStatusKind" AS ENUM ('MANAGE_PRODUCTION', 'PRODUCTION_COMPLETED');

-- AlterTable
ALTER TABLE "sale_series" DROP COLUMN "billing",
ADD COLUMN     "billing" "BiilingKind" NOT NULL DEFAULT 'ON_ORDER',
DROP COLUMN "productionStatus",
ADD COLUMN     "productionStatus" "ProductionStatusKind" NOT NULL DEFAULT 'MANAGE_PRODUCTION',
DROP COLUMN "sendToProduction",
ADD COLUMN     "sendToProduction" "SendToProductionKind" NOT NULL DEFAULT 'DIRECT';
