-- AlterEnum
ALTER TYPE "NfseStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "nfses" ADD COLUMN     "draftData" JSONB;
