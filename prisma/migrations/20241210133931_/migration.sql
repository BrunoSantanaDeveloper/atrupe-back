/*
  Warnings:

  - You are about to drop the column `isStageProduction` on the `sectors` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sectors" DROP COLUMN "isStageProduction",
ADD COLUMN     "isProductionStage" BOOLEAN NOT NULL DEFAULT true;
