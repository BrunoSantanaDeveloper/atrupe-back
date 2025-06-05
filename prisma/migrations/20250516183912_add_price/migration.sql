/*
  Warnings:

  - Added the required column `planPrice` to the `subscriptions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "planPrice" DOUBLE PRECISION NOT NULL;
