-- AlterTable
ALTER TABLE "invoicy_configs" ADD COLUMN "contingenciaNfceAtiva" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "contingenciaNfceMotivo" TEXT,
ADD COLUMN "contingenciaNfceDataHora" TIMESTAMP(3),
ADD COLUMN "prazoCancelamentoNfce" INTEGER NOT NULL DEFAULT 30;
