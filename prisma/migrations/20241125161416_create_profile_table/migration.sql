/*
  Warnings:

  - You are about to drop the column `canApprovePreRegistration` on the `roles` table. All the data in the column will be lost.
  - You are about to drop the column `canCancelSale` on the `roles` table. All the data in the column will be lost.
  - You are about to drop the column `commission` on the `roles` table. All the data in the column will be lost.
  - You are about to drop the column `maxDiscount` on the `roles` table. All the data in the column will be lost.
  - You are about to drop the column `minValue` on the `roles` table. All the data in the column will be lost.
  - Added the required column `description` to the `quotation_products` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "sellerProfileId" TEXT;

-- AlterTable
ALTER TABLE "quotation_products" ADD COLUMN     "description" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "roles" DROP COLUMN "canApprovePreRegistration",
DROP COLUMN "canCancelSale",
DROP COLUMN "commission",
DROP COLUMN "maxDiscount",
DROP COLUMN "minValue";

-- CreateTable
CREATE TABLE "seller_profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "commission" DOUBLE PRECISION,
    "maxDiscount" DOUBLE PRECISION,
    "minValue" DOUBLE PRECISION,
    "canApprovePreRegistration" BOOLEAN NOT NULL DEFAULT false,
    "canCancelSale" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "seller_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_profile_name_key" ON "seller_profile"("name");

-- AddForeignKey
ALTER TABLE "seller_profile" ADD CONSTRAINT "seller_profile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "seller_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
