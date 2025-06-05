/*
  Warnings:

  - You are about to drop the column `details` on the `clients` table. All the data in the column will be lost.
  - You are about to drop the column `kind` on the `clients` table. All the data in the column will be lost.
  - You are about to drop the column `mobilePhone` on the `clients` table. All the data in the column will be lost.
  - You are about to drop the column `phoneNumber` on the `clients` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[email,companyId]` on the table `clients` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "clients_email_key";

-- AlterTable
ALTER TABLE "clients" DROP COLUMN "details",
DROP COLUMN "kind",
DROP COLUMN "mobilePhone",
DROP COLUMN "phoneNumber",
ADD COLUMN     "activity" TEXT,
ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "corporateName" TEXT,
ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "rg" TEXT,
ADD COLUMN     "tradeName" TEXT,
ADD COLUMN     "type" "ClientKind" NOT NULL DEFAULT 'PERSON';

-- CreateIndex
CREATE UNIQUE INDEX "clients_email_companyId_key" ON "clients"("email", "companyId");
