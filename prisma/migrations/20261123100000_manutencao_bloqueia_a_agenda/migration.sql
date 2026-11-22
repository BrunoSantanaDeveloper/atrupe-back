-- Manutenção que bloqueia a agenda da máquina (GP-49 item 6, ELITE)
ALTER TABLE "asset_costs" ADD COLUMN "blocksSchedule" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "asset_costs" ADD COLUMN "blockStart" TEXT;
ALTER TABLE "asset_costs" ADD COLUMN "blockMinutes" INTEGER;
