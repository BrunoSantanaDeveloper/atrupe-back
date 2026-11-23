-- Os blocos de agenda da tarefa (GP-52; Maicol, 23/11/2026, ELITE): dividir
-- um trabalho em dois dias e acrescentar tempo com motivo. O agendamento da
-- tarefa continua sendo o bloco 1. O tempo de cada pessoa diz de qual bloco
-- é (sem bloco = o bloco 1).
CREATE TYPE "ProductionSlotKind" AS ENUM ('NORMAL', 'EXTRA');

CREATE TABLE "production_task_slots" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "start" TEXT,
    "minutes" INTEGER NOT NULL,
    "kind" "ProductionSlotKind" NOT NULL DEFAULT 'NORMAL',
    "reason" TEXT,
    "byName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_task_slots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "production_task_slots_taskId_idx" ON "production_task_slots"("taskId");
CREATE INDEX "production_task_slots_companyId_date_idx" ON "production_task_slots"("companyId", "date");

ALTER TABLE "production_task_slots" ADD CONSTRAINT "production_task_slots_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "production_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_time_entries" ADD COLUMN "slotId" TEXT;
ALTER TABLE "production_time_entries" ADD CONSTRAINT "production_time_entries_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "production_task_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
