/*
  Warnings:

  - Added the required column `bankAccountId` to the `payables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `categoryId` to the `payables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `clientId` to the `payables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentMethodId` to the `payables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `refereceDate` to the `payables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reference` to the `payables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `bankAccountId` to the `receivables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `categoryId` to the `receivables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `clientId` to the `receivables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentMethodId` to the `receivables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `refereceDate` to the `receivables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `reference` to the `receivables` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CategoryKind" ADD VALUE 'PAYABLE';
ALTER TYPE "CategoryKind" ADD VALUE 'RECEIVABLE';

-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "bankAccountId" TEXT NOT NULL,
ADD COLUMN     "categoryId" TEXT NOT NULL,
ADD COLUMN     "clientId" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "paymentMethodId" TEXT NOT NULL,
ADD COLUMN     "refereceDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "reference" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "bankAccountId" TEXT NOT NULL,
ADD COLUMN     "categoryId" TEXT NOT NULL,
ADD COLUMN     "clientId" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "paymentMethodId" TEXT NOT NULL,
ADD COLUMN     "refereceDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "reference" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
