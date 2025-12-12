/*
  Warnings:

  - The values [SUCCESS,PENDING,FAILED] on the enum `SubscriptionStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BillingType" ADD VALUE 'DEBIT_CARD';
ALTER TYPE "BillingType" ADD VALUE 'TRANSFER';
ALTER TYPE "BillingType" ADD VALUE 'DEPOSIT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Cycle" ADD VALUE 'WEEKLY';
ALTER TYPE "Cycle" ADD VALUE 'BIWEEKLY';
ALTER TYPE "Cycle" ADD VALUE 'BIMONTHLY';
ALTER TYPE "Cycle" ADD VALUE 'QUARTERLY';
ALTER TYPE "Cycle" ADD VALUE 'SEMIANNUALLY';

-- AlterEnum
BEGIN;
CREATE TYPE "SubscriptionStatus_new" AS ENUM ('ACTIVE', 'EXPIRED', 'INACTIVE');
ALTER TYPE "SubscriptionStatus" RENAME TO "SubscriptionStatus_old";
ALTER TYPE "SubscriptionStatus_new" RENAME TO "SubscriptionStatus";
DROP TYPE "SubscriptionStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "planType" "PlanType" NOT NULL DEFAULT 'START';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingType" "BillingType" NOT NULL DEFAULT 'CREDIT_CARD',
ADD COLUMN     "cycle" "Cycle" NOT NULL DEFAULT 'MONTHLY';
