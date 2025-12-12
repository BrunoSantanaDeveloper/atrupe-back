-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('LENGTH', 'WEIGHT', 'CAPACITY', 'DISTANCE', 'DURATION', 'UNITY', 'AREA');

-- AlterTable
ALTER TABLE "product_items" ADD COLUMN     "unitKind" "UnitKind";

-- AlterTable
ALTER TABLE "quotation_product_items" ADD COLUMN     "unitKind" "UnitKind"; 