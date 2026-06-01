-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DiscountType') THEN
    CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'VALUE');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CouponDuration') THEN
    CREATE TYPE "CouponDuration" AS ENUM ('ONCE', 'RECURRING', 'MONTHS');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "coupons" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "discountType" "DiscountType" NOT NULL,
  "discountValue" DOUBLE PRECISION NOT NULL,
  "durationType" "CouponDuration" NOT NULL DEFAULT 'ONCE',
  "durationMonths" INTEGER,
  "maxUses" INTEGER,
  "currentUses" INTEGER NOT NULL DEFAULT 0,
  "maxUsesPerCompany" INTEGER NOT NULL DEFAULT 1,
  "minPlanValue" DOUBLE PRECISION,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "appliesToPlans" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "appliesToModules" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3),
  "createdBy" TEXT,

  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "couponId" TEXT,
  ADD COLUMN IF NOT EXISTS "couponCode" TEXT,
  ADD COLUMN IF NOT EXISTS "discountValue" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "discountType" "DiscountType";

-- CreateTable
CREATE TABLE IF NOT EXISTS "coupon_usages" (
  "id" TEXT NOT NULL,
  "couponId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "discountApplied" DOUBLE PRECISION NOT NULL,
  "originalValue" DOUBLE PRECISION NOT NULL,
  "finalValue" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coupon_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "coupons_code_idx" ON "coupons"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "coupons_isActive_validUntil_idx" ON "coupons"("isActive", "validUntil");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "coupon_usages_couponId_idx" ON "coupon_usages"("couponId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "coupon_usages_companyId_idx" ON "coupon_usages"("companyId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_couponId_fkey'
  ) THEN
    ALTER TABLE "subscriptions"
      ADD CONSTRAINT "subscriptions_couponId_fkey"
      FOREIGN KEY ("couponId") REFERENCES "coupons"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupon_usages_couponId_fkey'
  ) THEN
    ALTER TABLE "coupon_usages"
      ADD CONSTRAINT "coupon_usages_couponId_fkey"
      FOREIGN KEY ("couponId") REFERENCES "coupons"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
