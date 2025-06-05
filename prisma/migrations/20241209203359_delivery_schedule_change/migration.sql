/*
  Warnings:

  - A unique constraint covering the columns `[quotationId]` on the table `DeliverySchedule` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[deliveryInfoId]` on the table `DeliverySchedule` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[orderId]` on the table `DeliverySchedule` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "DeliverySchedule" DROP CONSTRAINT "DeliverySchedule_orderId_fkey";

-- AlterTable
ALTER TABLE "DeliverySchedule" ADD COLUMN     "deliveryInfoId" TEXT,
ADD COLUMN     "quotationId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySchedule_quotationId_key" ON "DeliverySchedule"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySchedule_deliveryInfoId_key" ON "DeliverySchedule"("deliveryInfoId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySchedule_orderId_key" ON "DeliverySchedule"("orderId");

-- AddForeignKey
ALTER TABLE "DeliverySchedule" ADD CONSTRAINT "DeliverySchedule_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySchedule" ADD CONSTRAINT "DeliverySchedule_deliveryInfoId_fkey" FOREIGN KEY ("deliveryInfoId") REFERENCES "DeliveryInfo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySchedule" ADD CONSTRAINT "DeliverySchedule_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
