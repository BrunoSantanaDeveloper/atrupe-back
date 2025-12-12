-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "planType" "PlanType" NOT NULL DEFAULT 'START';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingType" "BillingType" NOT NULL DEFAULT 'CREDIT_CARD',
ADD COLUMN     "cycle" "Cycle" NOT NULL DEFAULT 'MONTHLY';
