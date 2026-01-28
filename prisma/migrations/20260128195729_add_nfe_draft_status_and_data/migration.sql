-- AlterEnum
ALTER TYPE "NfeStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "nfes" ADD COLUMN     "draftData" JSONB;
