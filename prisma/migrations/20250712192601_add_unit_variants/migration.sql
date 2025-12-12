-- CreateEnum
CREATE TYPE "UnitOfMeasureVariant" AS ENUM ('MT', 'CM', 'MM', 'KG', 'GR', 'MG', 'LT', 'ML');

-- AlterTable
ALTER TABLE "defalt_unit_measures" ADD COLUMN     "defaultVariant" "UnitOfMeasureVariant",
ADD COLUMN     "variant" "UnitOfMeasureVariant";

-- AlterTable
ALTER TABLE "unit_measures" ADD COLUMN     "defaultVariant" "UnitOfMeasureVariant",
ADD COLUMN     "variant" "UnitOfMeasureVariant";
