-- CreateTable
CREATE TABLE "company_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changes" JSONB,
    "metadata" JSONB,
    "createdBy" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_history_companyId_idx" ON "company_history"("companyId");

-- CreateIndex
CREATE INDEX "company_history_createdAt_idx" ON "company_history"("createdAt");

-- CreateIndex
CREATE INDEX "company_history_createdBy_idx" ON "company_history"("createdBy");

-- AddForeignKey
ALTER TABLE "company_history" ADD CONSTRAINT "company_history_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_history" ADD CONSTRAINT "company_history_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
