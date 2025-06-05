-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('IN_PRODUCTION', 'DELIVERY', 'COMPLETED');

-- AlterEnum
ALTER TYPE "QuotationStatus" ADD VALUE 'DONE';

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "quotationId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'IN_PRODUCTION',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_id_idx" ON "orders"("id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
