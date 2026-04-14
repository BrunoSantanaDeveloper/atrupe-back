-- AlterTable
ALTER TABLE "digital_certificates" 
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "issuer" TEXT,
ADD COLUMN "serialNumber" TEXT;
