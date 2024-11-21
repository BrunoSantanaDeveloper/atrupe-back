/*
  Warnings:

  - You are about to drop the column `commission` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `maxDiscount` on the `employees` table. All the data in the column will be lost.
  - You are about to drop the column `minValue` on the `employees` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "employees" DROP COLUMN "commission",
DROP COLUMN "maxDiscount",
DROP COLUMN "minValue";

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "canApprovePreRegistration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canCancelSale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commission" DOUBLE PRECISION,
ADD COLUMN     "maxDiscount" DOUBLE PRECISION,
ADD COLUMN     "minValue" DOUBLE PRECISION;
