/*
  Warnings:

  - You are about to drop the column `observations` on the `contacts` table. All the data in the column will be lost.
  - You are about to drop the column `bankAccountId` on the `payables` table. All the data in the column will be lost.
  - You are about to drop the column `dueDate` on the `payables` table. All the data in the column will be lost.
  - You are about to drop the column `observations` on the `payables` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMethodId` on the `payables` table. All the data in the column will be lost.
  - You are about to drop the column `bankAccountId` on the `receivables` table. All the data in the column will be lost.
  - You are about to drop the column `dueDate` on the `receivables` table. All the data in the column will be lost.
  - You are about to drop the column `observations` on the `receivables` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMethodId` on the `receivables` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_bankAccountId_fkey";

-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_paymentMethodId_fkey";

-- DropForeignKey
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_bankAccountId_fkey";

-- DropForeignKey
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_paymentMethodId_fkey";

-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "observations",
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "payables" DROP COLUMN "bankAccountId",
DROP COLUMN "dueDate",
DROP COLUMN "observations",
DROP COLUMN "paymentMethodId",
ADD COLUMN     "notes" TEXT,
ALTER COLUMN "reference" DROP NOT NULL;

-- AlterTable
ALTER TABLE "receivables" DROP COLUMN "bankAccountId",
DROP COLUMN "dueDate",
DROP COLUMN "observations",
DROP COLUMN "paymentMethodId",
ADD COLUMN     "notes" TEXT;
