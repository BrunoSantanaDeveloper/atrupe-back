/*
  Warnings:

  - Made the column `reference` on table `salary_controls` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "salary_controls" ALTER COLUMN "reference" SET NOT NULL;

-- AlterTable
ALTER TABLE "salary_items" ADD COLUMN     "paidAt" TIMESTAMP(3),
ALTER COLUMN "description" DROP NOT NULL;
