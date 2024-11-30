/*
  Warnings:

  - The `transferMethod` column on the `Commission` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "transferMethodCommission" AS ENUM ('SINGLE', 'CONFORMING');

-- AlterTable
ALTER TABLE "Commission" DROP COLUMN "transferMethod",
ADD COLUMN     "transferMethod" "transferMethodCommission" NOT NULL DEFAULT 'SINGLE';

-- DropEnum
DROP TYPE "transferMethodComission";
