/*
  Warnings:

  - You are about to drop the column `financialHistory` on the `clients` table. All the data in the column will be lost.
  - You are about to drop the column `orderHistory` on the `clients` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "clients" DROP COLUMN "financialHistory",
DROP COLUMN "orderHistory",
ADD COLUMN     "status" "ClientStatus" NOT NULL DEFAULT 'INACTIVE';
