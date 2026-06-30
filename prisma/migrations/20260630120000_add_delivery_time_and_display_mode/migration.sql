-- AlterTable: add deliveryTime and deliveryDisplayMode to delivery_info
ALTER TABLE "delivery_info" ADD COLUMN "deliveryTime" TEXT;
ALTER TABLE "delivery_info" ADD COLUMN "deliveryDisplayMode" TEXT NOT NULL DEFAULT 'DAYS';
