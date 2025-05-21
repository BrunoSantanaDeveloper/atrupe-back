/*
  Warnings:

  - You are about to drop the column `extraUsers` on the `plans` table. All the data in the column will be lost.
  - You are about to drop the column `hasNfe` on the `plans` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "plans" DROP COLUMN "extraUsers",
DROP COLUMN "hasNfe";
