-- Precisão do tempo da linha da composição e do processo (20/11/2026):
-- "h", "hm" ou "hms"; nulo vale hh:mm:ss
ALTER TABLE "assembly_lines" ADD COLUMN "timePrecision" TEXT;
