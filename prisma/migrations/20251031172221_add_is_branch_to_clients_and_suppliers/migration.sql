-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "isBranch" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "isBranch" BOOLEAN NOT NULL DEFAULT false;
