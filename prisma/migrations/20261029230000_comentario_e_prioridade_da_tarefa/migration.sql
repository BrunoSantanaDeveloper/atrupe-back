-- Comentário da equipe na tarefa e prioridade urgente (VS-5; GP-47, itens 3
-- e 4; decisão do produto de 29/10/2026). O comentário é uma linha do
-- histórico com `kind = COMMENT`; a tarefa urgente sobe na fila do setor.
CREATE TYPE "ProductionTaskPriority" AS ENUM ('NORMAL', 'URGENT');
CREATE TYPE "ProductionHistoryKind" AS ENUM ('EVENT', 'COMMENT');

ALTER TABLE "production_tasks"
  ADD COLUMN "priority" "ProductionTaskPriority" NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "production_task_history"
  ADD COLUMN "kind" "ProductionHistoryKind" NOT NULL DEFAULT 'EVENT';
