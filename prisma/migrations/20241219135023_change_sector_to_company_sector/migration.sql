-- AlterTable
ALTER TABLE "sectors" ADD COLUMN     "defaultSectorId" TEXT;

-- CreateTable
CREATE TABLE "default_sectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "kind" "SectorKind" NOT NULL DEFAULT 'PRODUCTION',

    CONSTRAINT "default_sectors_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_defaultSectorId_fkey" FOREIGN KEY ("defaultSectorId") REFERENCES "default_sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
