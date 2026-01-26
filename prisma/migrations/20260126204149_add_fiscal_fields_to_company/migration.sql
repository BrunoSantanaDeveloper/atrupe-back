-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "certificateDescription" TEXT,
ADD COLUMN     "certificateModifiedAt" TIMESTAMP(3),
ADD COLUMN     "certificatePassword" TEXT,
ADD COLUMN     "certificateType" TEXT,
ADD COLUMN     "certificateUrl" TEXT,
ADD COLUMN     "cnae" TEXT,
ADD COLUMN     "partnerKey" TEXT;
