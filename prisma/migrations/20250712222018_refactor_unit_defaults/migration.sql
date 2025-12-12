/*
  Warnings:

  - You are about to drop the column `defaultVariant` on the `defalt_unit_measures` table. All the data in the column will be lost.
  - You are about to drop the column `defaultVariant` on the `unit_measures` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "unitDefaults" JSONB;

-- AlterTable
ALTER TABLE "defalt_unit_measures" DROP COLUMN "defaultVariant";

-- AlterTable
ALTER TABLE "unit_measures" DROP COLUMN "defaultVariant";
