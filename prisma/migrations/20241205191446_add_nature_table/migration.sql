/*
  Warnings:

  - You are about to drop the column `nature` on the `payables` table. All the data in the column will be lost.
  - You are about to drop the column `nature` on the `receivables` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ProductionStage" ALTER COLUMN "updatedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payables" DROP COLUMN "nature",
ADD COLUMN     "natureId" TEXT;

-- AlterTable
ALTER TABLE "receivables" DROP COLUMN "nature",
ADD COLUMN     "natureId" TEXT;

-- CreateTable
CREATE TABLE "Nature" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Nature_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "Nature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_natureId_fkey" FOREIGN KEY ("natureId") REFERENCES "Nature"("id") ON DELETE SET NULL ON UPDATE CASCADE;
