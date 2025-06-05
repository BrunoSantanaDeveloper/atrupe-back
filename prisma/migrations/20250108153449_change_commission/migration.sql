/*
  Warnings:

  - The values [CONFORMING] on the enum `transferMethodCommission` will be removed. If these variants are still used in the database, this will fail.
  - Made the column `commissionValue` on table `commissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `totalCommission` on table `commissions` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "transferMethodCommission_new" AS ENUM ('SINGLE', 'PAYMENT_BASED');
ALTER TABLE "commissions" ALTER COLUMN "transferMethod" DROP DEFAULT;
ALTER TABLE "commissions" ALTER COLUMN "transferMethod" TYPE "transferMethodCommission_new" USING ("transferMethod"::text::"transferMethodCommission_new");
ALTER TYPE "transferMethodCommission" RENAME TO "transferMethodCommission_old";
ALTER TYPE "transferMethodCommission_new" RENAME TO "transferMethodCommission";
DROP TYPE "transferMethodCommission_old";
ALTER TABLE "commissions" ALTER COLUMN "transferMethod" SET DEFAULT 'SINGLE';
COMMIT;

-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "commissionType" TEXT NOT NULL DEFAULT 'VALUE',
ALTER COLUMN "commissionValue" SET NOT NULL,
ALTER COLUMN "commissionValue" SET DEFAULT 0,
ALTER COLUMN "totalCommission" SET NOT NULL,
ALTER COLUMN "totalCommission" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "installments" ADD COLUMN     "dueDate" TIMESTAMP(3);
