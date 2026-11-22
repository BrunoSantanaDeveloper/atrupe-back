-- O gerenciador ganha o expediente próprio com o intervalo, a agenda viva e
-- o tempo após a conclusão (GP-48 itens 19 a 21, 22/11/2026). Sem o
-- expediente, vale o da empresa (production_calendars). Os gerenciadores
-- existentes ficam como estavam: só avisa, sem tempo após a conclusão.
CREATE TYPE "ProductionLiveSchedule" AS ENUM ('WARN', 'RESCHEDULE');

ALTER TABLE "production_managers"
  ADD COLUMN "workStart" TEXT,
  ADD COLUMN "workEnd" TEXT,
  ADD COLUMN "breakStart" TEXT,
  ADD COLUMN "breakEnd" TEXT,
  ADD COLUMN "runsThroughBreak" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "liveSchedule" "ProductionLiveSchedule" NOT NULL DEFAULT 'WARN',
  ADD COLUMN "afterDoneMinutes" INTEGER NOT NULL DEFAULT 0;
