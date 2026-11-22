-- A tarefa da produção guarda a qualidade vendida (GP-48 item 22, 22/11/2026):
-- a configuração da máquina (AssetSetup) da linha de máquina da etapa. O
-- tempo previsto passa a somar a linha de máquina vendida em m², m ou un,
-- convertida pelo tempo por unidade da qualidade. As tarefas existentes
-- ficam sem a qualidade até a O.S. ser refeita.
ALTER TABLE "production_tasks" ADD COLUMN "machineSetupId" TEXT;
ALTER TABLE "production_tasks" ADD COLUMN "machineQuality" TEXT;
