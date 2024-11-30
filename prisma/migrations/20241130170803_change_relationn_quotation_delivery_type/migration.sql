/*
  Warnings:

  - A unique constraint covering the columns `[quotationId]` on the table `DeliveryInfo` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "DeliveryInfo_quotationId_key" ON "DeliveryInfo"("quotationId");
