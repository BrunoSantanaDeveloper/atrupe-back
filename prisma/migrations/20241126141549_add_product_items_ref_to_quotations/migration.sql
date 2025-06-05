/*
  Warnings:

  - You are about to drop the column `salePrice` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `unitCost` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `unitOfMeasureId` on the `products` table. All the data in the column will be lost.
  - Added the required column `name` to the `quotation_product_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitOfMeasureId` to the `quotation_product_items` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_unitOfMeasureId_fkey";

-- AlterTable
ALTER TABLE "product_items" ADD COLUMN     "distance" DOUBLE PRECISION,
ADD COLUMN     "duration" DOUBLE PRECISION,
ADD COLUMN     "height" DOUBLE PRECISION,
ADD COLUMN     "length" DOUBLE PRECISION,
ADD COLUMN     "volume" DOUBLE PRECISION,
ADD COLUMN     "weight" DOUBLE PRECISION,
ADD COLUMN     "width" DOUBLE PRECISION,
ALTER COLUMN "unitCost" DROP NOT NULL,
ALTER COLUMN "salePrice" DROP NOT NULL;

-- AlterTable
ALTER TABLE "products" DROP COLUMN "salePrice",
DROP COLUMN "unitCost",
DROP COLUMN "unitOfMeasureId";

-- AlterTable
ALTER TABLE "quotation_product_items" ADD COLUMN     "distance" DOUBLE PRECISION,
ADD COLUMN     "duration" DOUBLE PRECISION,
ADD COLUMN     "height" DOUBLE PRECISION,
ADD COLUMN     "length" DOUBLE PRECISION,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "salePrice" DOUBLE PRECISION,
ADD COLUMN     "unitCost" DOUBLE PRECISION,
ADD COLUMN     "unitOfMeasureId" TEXT NOT NULL,
ADD COLUMN     "volume" DOUBLE PRECISION,
ADD COLUMN     "weight" DOUBLE PRECISION,
ADD COLUMN     "width" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "quotation_products" ADD COLUMN     "allowEditDescription" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowEditValues" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "technicalDescription" TEXT,
ALTER COLUMN "description" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "quotation_product_items" ADD CONSTRAINT "quotation_product_items_unitOfMeasureId_fkey" FOREIGN KEY ("unitOfMeasureId") REFERENCES "unit_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
