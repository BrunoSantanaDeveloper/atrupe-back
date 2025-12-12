-- AlterTable
ALTER TABLE "users" ADD COLUMN     "trial" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);
