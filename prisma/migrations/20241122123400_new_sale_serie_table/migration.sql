/*
  Warnings:

  - You are about to drop the column `deliveryDuration` on the `sale_series` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `sale_series` table. All the data in the column will be lost.
  - You are about to drop the column `quotationDuration` on the `sale_series` table. All the data in the column will be lost.
  - You are about to drop the column `taxCosts` on the `sale_series` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[code]` on the table `sale_series` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `title` to the `sale_series` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sale_series" DROP COLUMN "deliveryDuration",
DROP COLUMN "name",
DROP COLUMN "quotationDuration",
DROP COLUMN "taxCosts",
ADD COLUMN     "billing" TEXT,
ADD COLUMN     "currentBudgetNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryDeadline" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "productionStatus" TEXT,
ADD COLUMN     "proposalValidity" INTEGER,
ADD COLUMN     "sendToProduction" TEXT,
ADD COLUMN     "textAfterItems" TEXT,
ADD COLUMN     "textBeforeItems" TEXT,
ADD COLUMN     "title" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "sale_series_code_key" ON "sale_series"("code");
