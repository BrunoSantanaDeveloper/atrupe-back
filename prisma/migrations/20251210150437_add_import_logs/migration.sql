-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'VALIDATING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "import_logs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "entity" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_url" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "success_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_logs_user_id_idx" ON "import_logs"("user_id");

-- CreateIndex
CREATE INDEX "import_logs_company_id_idx" ON "import_logs"("company_id");

-- CreateIndex
CREATE INDEX "import_logs_status_idx" ON "import_logs"("status");

-- CreateIndex
CREATE INDEX "import_logs_entity_idx" ON "import_logs"("entity");

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
