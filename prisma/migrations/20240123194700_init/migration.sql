/*
  Warnings:

  - You are about to drop the column `contact` on the `clients` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email]` on the table `clients` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `details` to the `clients` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('PERSON', 'COMPANY');

-- AlterTable
ALTER TABLE "clients" DROP COLUMN "contact",
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "details" JSONB NOT NULL,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "kind" "ClientKind" NOT NULL DEFAULT 'PERSON',
ADD COLUMN     "mobilePhone" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PROSPECT';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "categoryId" TEXT;

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL DEFAULT 'PRODUCT',

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_email_key" ON "clients"("email");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
