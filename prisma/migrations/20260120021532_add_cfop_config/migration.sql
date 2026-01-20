-- CreateTable
CREATE TABLE "cfop_configs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "nature" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cfop_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cfop_configs_companyId_idx" ON "cfop_configs"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "cfop_configs_companyId_code_key" ON "cfop_configs"("companyId", "code");

-- AddForeignKey
ALTER TABLE "cfop_configs" ADD CONSTRAINT "cfop_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
