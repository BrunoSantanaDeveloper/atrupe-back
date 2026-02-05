-- CreateEnum
CREATE TYPE "BlockLevel" AS ENUM ('NONE', 'PARTIAL', 'FULL');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "blockLevel" "BlockLevel" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "blockReason" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3);
