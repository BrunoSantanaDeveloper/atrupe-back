/*
  Warnings:

  - You are about to drop the column `cityId` on the `addresses` table. All the data in the column will be lost.
  - You are about to drop the column `stateId` on the `addresses` table. All the data in the column will be lost.
  - You are about to drop the column `categoryId` on the `clients` table. All the data in the column will be lost.
  - You are about to drop the `cities` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `states` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "addresses" DROP CONSTRAINT "addresses_cityId_fkey";

-- DropForeignKey
ALTER TABLE "addresses" DROP CONSTRAINT "addresses_stateId_fkey";

-- DropForeignKey
ALTER TABLE "cities" DROP CONSTRAINT "cities_stateId_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_categoryId_fkey";

-- DropIndex
DROP INDEX "contacts_email_key";

-- AlterTable
ALTER TABLE "addresses" DROP COLUMN "cityId",
DROP COLUMN "stateId",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'Principal';

-- AlterTable
ALTER TABLE "clients" DROP COLUMN "categoryId",
ADD COLUMN     "category" TEXT;

-- DropTable
DROP TABLE "cities";

-- DropTable
DROP TABLE "states";

-- CreateTable
CREATE TABLE "client_payment_conditions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "clientId" TEXT NOT NULL,
    "paymentConditionId" TEXT NOT NULL,

    CONSTRAINT "client_payment_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_payment_conditions_clientId_paymentConditionId_key" ON "client_payment_conditions"("clientId", "paymentConditionId");

-- AddForeignKey
ALTER TABLE "client_payment_conditions" ADD CONSTRAINT "client_payment_conditions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_payment_conditions" ADD CONSTRAINT "client_payment_conditions_paymentConditionId_fkey" FOREIGN KEY ("paymentConditionId") REFERENCES "payment_conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
