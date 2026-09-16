-- CreateEnum
CREATE TYPE "MigrationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "migration_runs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "companyId" TEXT NOT NULL,
    "legacyBase" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "status" "MigrationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,
    "errors" JSONB,
    "failureReason" TEXT,
    "startedById" TEXT NOT NULL,

    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "migration_runs_companyId_idx" ON "migration_runs"("companyId");
CREATE INDEX "migration_runs_status_idx" ON "migration_runs"("status");

-- AddForeignKey
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
