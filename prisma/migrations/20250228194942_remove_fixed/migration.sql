/*
  Warnings:

  - The values [FIXED] on the enum `PaymentConditionCostType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PaymentConditionCostType_new" AS ENUM ('PERCENT', 'VALUE');
ALTER TABLE "payment_conditions" ALTER COLUMN "costType" TYPE "PaymentConditionCostType_new" USING ("costType"::text::"PaymentConditionCostType_new");
ALTER TYPE "PaymentConditionCostType" RENAME TO "PaymentConditionCostType_old";
ALTER TYPE "PaymentConditionCostType_new" RENAME TO "PaymentConditionCostType";
DROP TYPE "PaymentConditionCostType_old";
COMMIT;
