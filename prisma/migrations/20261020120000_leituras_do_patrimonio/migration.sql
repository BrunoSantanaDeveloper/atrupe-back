-- Leituras do contador do bem (hodômetro, horímetro, contador de m²): o
-- volume do período no comparativo da base de custos. Sai junto com o bem.

-- CreateTable
CREATE TABLE "asset_readings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_readings_assetId_date_idx" ON "asset_readings"("assetId", "date");

-- CreateIndex
CREATE INDEX "asset_readings_companyId_date_idx" ON "asset_readings"("companyId", "date");

-- AddForeignKey
ALTER TABLE "asset_readings" ADD CONSTRAINT "asset_readings_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
