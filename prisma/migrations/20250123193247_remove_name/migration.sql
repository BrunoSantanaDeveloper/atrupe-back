/*
  Warnings:

  - You are about to drop the column `name` on the `natures` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `sub_categories` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "natures" DROP COLUMN "name";

-- AlterTable
ALTER TABLE "sub_categories" DROP COLUMN "name";
