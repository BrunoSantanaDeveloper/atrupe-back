-- AlterTable
ALTER TABLE "cfop_configs" ADD COLUMN     "info" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "isService" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "operation_natures" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "finality" TEXT NOT NULL,
    "consumerPresence" TEXT NOT NULL,
    "info" TEXT,
    "cfopInternalId" TEXT,
    "cfopExternalId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operation_natures_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "operation_natures" ADD CONSTRAINT "operation_natures_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_natures" ADD CONSTRAINT "operation_natures_cfopInternalId_fkey" FOREIGN KEY ("cfopInternalId") REFERENCES "cfop_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_natures" ADD CONSTRAINT "operation_natures_cfopExternalId_fkey" FOREIGN KEY ("cfopExternalId") REFERENCES "cfop_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
