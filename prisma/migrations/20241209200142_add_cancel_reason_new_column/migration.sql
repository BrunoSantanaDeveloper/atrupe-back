/*
  Warnings:

  - You are about to drop the column `reasonsId` on the `orders` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_reasonsId_fkey";

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "reasonsId",
ADD COLUMN     "reasonId" TEXT;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
