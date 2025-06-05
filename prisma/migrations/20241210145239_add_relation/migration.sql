/*
  Warnings:

  - You are about to drop the column `stage` on the `ProductionStage` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ProductionStage" DROP COLUMN "stage",
ADD COLUMN     "stageId" TEXT;

-- AddForeignKey
ALTER TABLE "ProductionStage" ADD CONSTRAINT "ProductionStage_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
