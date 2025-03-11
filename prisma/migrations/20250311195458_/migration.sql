-- AlterEnum
ALTER TYPE "SectorKind" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "sectors" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;
