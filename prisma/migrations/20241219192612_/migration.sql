/*
  Warnings:

  - You are about to drop the column `deliveryTypeId` on the `delivery_info` table. All the data in the column will be lost.
  - You are about to drop the `delivery_types` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('INSTALLATION', 'CARRIER', 'PICKUP');

-- DropForeignKey
ALTER TABLE "delivery_info" DROP CONSTRAINT "delivery_info_deliveryTypeId_fkey";

-- DropForeignKey
ALTER TABLE "delivery_types" DROP CONSTRAINT "delivery_types_companyId_fkey";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "deliveryType" "DeliveryType"[];

-- AlterTable
ALTER TABLE "delivery_info" DROP COLUMN "deliveryTypeId",
ADD COLUMN     "deliveryType" "DeliveryType" NOT NULL DEFAULT 'CARRIER';

-- DropTable
DROP TABLE "delivery_types";
