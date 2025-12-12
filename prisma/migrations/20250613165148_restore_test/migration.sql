/*
  Warnings:

  - You are about to drop the column `userId` on the `customers` table. All the data in the column will be lost.
  - You are about to drop the column `planType` on the `plans` table. All the data in the column will be lost.
  - You are about to drop the column `billingType` on the `subscriptions` table. All the data in the column will be lost.
  - You are about to drop the column `cycle` on the `subscriptions` table. All the data in the column will be lost.
  - You are about to drop the column `trial` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `trialEndsAt` on the `users` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_userId_fkey";

-- DropIndex
DROP INDEX "customers_userId_key";

-- AlterTable
ALTER TABLE "customers" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "plans" DROP COLUMN "planType";

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "billingType",
DROP COLUMN "cycle";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "trial",
DROP COLUMN "trialEndsAt";
