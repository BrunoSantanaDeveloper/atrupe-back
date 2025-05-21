-- CreateEnum
CREATE TYPE "Cycle" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "cycle" "Cycle" NOT NULL DEFAULT 'MONTHLY';
