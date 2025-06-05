/*
  Warnings:

  - You are about to drop the column `clientId` on the `payables` table. All the data in the column will be lost.
  - Added the required column `supplierId` to the `payables` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_clientId_fkey";

-- AlterTable
ALTER TABLE "payables" DROP COLUMN "clientId",
ADD COLUMN     "supplierId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
