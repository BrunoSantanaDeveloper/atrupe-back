-- A limpeza do espaço dos arquivos de produção (GP-49, 22/11/2026): a versão
-- apagada fica registrada e sai do espaço usado; o registro de cada limpeza
-- e a limpeza automática, que nasce desligada.
ALTER TABLE "production_attachment_versions" ADD COLUMN "removedAt" TIMESTAMP(3);

CREATE TABLE "production_storage_cleanups" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "percent" INTEGER NOT NULL,
    "files" INTEGER NOT NULL,
    "bytes" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "production_storage_cleanups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "production_storage_cleanups_companyId_at_idx" ON "production_storage_cleanups"("companyId", "at");

CREATE TABLE "production_storage_auto" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "percent" INTEGER NOT NULL DEFAULT 50,
    "threshold" INTEGER NOT NULL DEFAULT 90,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_storage_auto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_storage_auto_companyId_key" ON "production_storage_auto"("companyId");
