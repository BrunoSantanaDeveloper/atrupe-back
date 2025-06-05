/*
  Warnings:

  - The `ownerType` column on the `addresses` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('COMPANY', 'EMPLOYEE', 'CLIENT', 'SUPPLIER');

-- AlterTable
ALTER TABLE "addresses" DROP COLUMN "ownerType",
ADD COLUMN     "ownerType" "OwnerType" NOT NULL DEFAULT 'COMPANY';

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_email_key" ON "suppliers"("email");

-- CreateIndex
CREATE INDEX "addresses_ownerId_ownerType_idx" ON "addresses"("ownerId", "ownerType");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");
