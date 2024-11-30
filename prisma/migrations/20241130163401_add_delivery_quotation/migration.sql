-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('CLIENT_PICKUP', 'INSTALLATION', 'CARRIER', 'EXTERNAL_DELIVERY');

-- CreateTable
CREATE TABLE "DeliveryInfo" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "deliveryType" "DeliveryType" NOT NULL,
    "daysAfterApproval" INTEGER NOT NULL,
    "estimatedDate" TIMESTAMP(3) NOT NULL,
    "modality" TEXT NOT NULL DEFAULT 'Indefinida',
    "cost" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryInfo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryInfo_quotationId_idx" ON "DeliveryInfo"("quotationId");

-- AddForeignKey
ALTER TABLE "DeliveryInfo" ADD CONSTRAINT "DeliveryInfo_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryInfo" ADD CONSTRAINT "DeliveryInfo_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
