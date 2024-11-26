-- AlterTable
ALTER TABLE "products" ADD COLUMN     "allowEditDescription" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowEditValues" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "technicalDescription" TEXT;
