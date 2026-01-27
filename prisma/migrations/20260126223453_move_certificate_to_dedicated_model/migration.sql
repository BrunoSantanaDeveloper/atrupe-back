/*
  Warnings:

  - You are about to drop the column `certificateDescription` on the `companies` table. All the data in the column will be lost.
  - You are about to drop the column `certificateModifiedAt` on the `companies` table. All the data in the column will be lost.
  - You are about to drop the column `certificatePassword` on the `companies` table. All the data in the column will be lost.
  - You are about to drop the column `certificateType` on the `companies` table. All the data in the column will be lost.
  - You are about to drop the column `certificateUrl` on the `companies` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "DigitalCertificateType" AS ENUM ('A1', 'A3');

-- AlterTable
ALTER TABLE "companies" DROP COLUMN "certificateDescription",
DROP COLUMN "certificateModifiedAt",
DROP COLUMN "certificatePassword",
DROP COLUMN "certificateType",
DROP COLUMN "certificateUrl";

-- CreateTable
CREATE TABLE "digital_certificates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "DigitalCertificateType" NOT NULL DEFAULT 'A1',
    "description" TEXT,
    "password" TEXT,
    "certificate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "digital_certificates_companyId_key" ON "digital_certificates"("companyId");

-- AddForeignKey
ALTER TABLE "digital_certificates" ADD CONSTRAINT "digital_certificates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
