/*
  Warnings:

  - The `kind` column on the `defalt_unit_measures` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "defalt_unit_measures" DROP COLUMN "kind",
ADD COLUMN     "kind" "UnitOfMeasureKind";
