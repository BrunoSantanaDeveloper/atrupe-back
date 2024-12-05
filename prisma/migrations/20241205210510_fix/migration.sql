/*
  Warnings:

  - The values [CANCELED] on the enum `PaymentStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PaymentStatus_new" AS ENUM ('PENDING', 'PAID', 'OVERDUE');
ALTER TABLE "receivable_installments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payables" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payable_installments" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "receivables" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "receivables" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TABLE "receivable_installments" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TABLE "payables" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TABLE "payable_installments" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING ("status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "PaymentStatus_old";
ALTER TABLE "receivable_installments" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "payables" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "payable_installments" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "receivables" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropForeignKey
ALTER TABLE "receivables" DROP CONSTRAINT "receivables_categoryId_fkey";

-- AlterTable
ALTER TABLE "receivables" ALTER COLUMN "categoryId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
