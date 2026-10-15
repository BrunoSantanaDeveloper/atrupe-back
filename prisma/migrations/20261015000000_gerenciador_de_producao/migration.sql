-- Gerenciador de produção (módulo 3, ELITE, Fase 6): configuração (fluxo,
-- gerenciadores, perfis, tipos de tarefa com etapas, veículos), o projeto da
-- venda aprovada com as tarefas, o apontamento por pessoa, as correções, o
-- histórico e os anexos com versão. Só tabelas novas.

-- CreateEnum
CREATE TYPE "ProductionTimeMode" AS ENUM ('PLAY_STOP', 'DRAG_DROP');

-- CreateEnum
CREATE TYPE "ProductionReleaseRule" AS ENUM ('AFTER_BASE', 'WITH_BASE', 'DONE');

-- CreateEnum
CREATE TYPE "ProductionRole" AS ENUM ('OPERATOR', 'MANAGER');

-- CreateEnum
CREATE TYPE "ProductionProjectStatus" AS ENUM ('STANDBY', 'PRODUCTION', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProductionTaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'PENDING', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProductionTimeSource" AS ENUM ('CLOCK', 'DRAG', 'CORRECTION');

-- CreateEnum
CREATE TYPE "ProductionAttachmentKind" AS ENUM ('ART', 'CUT', 'PHOTO', 'OTHER');

-- CreateTable
CREATE TABLE "production_flows" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_managers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "timeMode" "ProductionTimeMode" NOT NULL DEFAULT 'PLAY_STOP',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_manager_users" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "onlyAssigned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "production_manager_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_collaborators" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" "ProductionRole" NOT NULL DEFAULT 'OPERATOR',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_collaborators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_task_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "release" "ProductionReleaseRule" NOT NULL DEFAULT 'AFTER_BASE',
    "timeControl" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_task_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_task_steps" (
    "id" TEXT NOT NULL,
    "taskTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_task_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_vehicles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_projects" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientName" TEXT NOT NULL DEFAULT '',
    "sellerName" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "deliveryType" TEXT NOT NULL DEFAULT '',
    "firstDue" DATE NOT NULL,
    "due" DATE NOT NULL,
    "status" "ProductionProjectStatus" NOT NULL DEFAULT 'STANDBY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_project_history" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "data" JSONB,

    CONSTRAINT "production_project_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_tasks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "quotationProductId" TEXT,
    "itemName" TEXT NOT NULL,
    "itemImage" TEXT,
    "stageName" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL DEFAULT '',
    "sectorId" TEXT,
    "sectorName" TEXT NOT NULL DEFAULT '',
    "taskTypeId" TEXT NOT NULL,
    "currentStepId" TEXT,
    "status" "ProductionTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "setupMinutes" INTEGER NOT NULL DEFAULT 0,
    "machine" TEXT,
    "baseTaskId" TEXT,
    "dependsOn" TEXT[],
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "measureText" TEXT NOT NULL DEFAULT '',
    "fields" TEXT[],
    "consumption" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "scheduleDate" DATE,
    "scheduleStart" TEXT,
    "scheduleMinutes" INTEGER,
    "assigneeId" TEXT,
    "pendencyText" TEXT,
    "pendencyAt" TIMESTAMP(3),
    "pendencyBy" TEXT,
    "releasedNext" JSONB,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "vehicleId" TEXT,
    "km" DOUBLE PRECISION,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_time_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3),
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "source" "ProductionTimeSource" NOT NULL DEFAULT 'CLOCK',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_time_corrections" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "production_time_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_task_history" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "affects" TEXT[],

    CONSTRAINT "production_task_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_attachments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProductionAttachmentKind" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_attachment_versions" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "production_attachment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_flows_companyId_name_key" ON "production_flows"("companyId", "name");

-- CreateIndex
CREATE INDEX "production_managers_companyId_idx" ON "production_managers"("companyId");

-- CreateIndex
CREATE INDEX "production_manager_users_employeeId_idx" ON "production_manager_users"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "production_manager_users_managerId_employeeId_key" ON "production_manager_users"("managerId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "production_collaborators_employeeId_key" ON "production_collaborators"("employeeId");

-- CreateIndex
CREATE INDEX "production_collaborators_companyId_idx" ON "production_collaborators"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "production_task_types_companyId_nameKey_key" ON "production_task_types"("companyId", "nameKey");

-- CreateIndex
CREATE INDEX "production_task_steps_taskTypeId_idx" ON "production_task_steps"("taskTypeId");

-- CreateIndex
CREATE INDEX "production_task_steps_managerId_idx" ON "production_task_steps"("managerId");

-- CreateIndex
CREATE INDEX "production_vehicles_companyId_idx" ON "production_vehicles"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "production_projects_quotationId_key" ON "production_projects"("quotationId");

-- CreateIndex
CREATE INDEX "production_projects_companyId_status_idx" ON "production_projects"("companyId", "status");

-- CreateIndex
CREATE INDEX "production_project_history_projectId_idx" ON "production_project_history"("projectId");

-- CreateIndex
CREATE INDEX "production_tasks_companyId_status_idx" ON "production_tasks"("companyId", "status");

-- CreateIndex
CREATE INDEX "production_tasks_currentStepId_idx" ON "production_tasks"("currentStepId");

-- CreateIndex
CREATE UNIQUE INDEX "production_tasks_projectId_code_key" ON "production_tasks"("projectId", "code");

-- CreateIndex
CREATE INDEX "production_time_entries_taskId_idx" ON "production_time_entries"("taskId");

-- CreateIndex
CREATE INDEX "production_time_entries_employeeId_end_idx" ON "production_time_entries"("employeeId", "end");

-- CreateIndex
CREATE INDEX "production_time_entries_companyId_end_idx" ON "production_time_entries"("companyId", "end");

-- CreateIndex
CREATE INDEX "production_time_corrections_taskId_idx" ON "production_time_corrections"("taskId");

-- CreateIndex
CREATE INDEX "production_task_history_taskId_idx" ON "production_task_history"("taskId");

-- CreateIndex
CREATE INDEX "production_attachments_taskId_idx" ON "production_attachments"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "production_attachment_versions_attachmentId_version_key" ON "production_attachment_versions"("attachmentId", "version");

-- AddForeignKey
ALTER TABLE "production_flows" ADD CONSTRAINT "production_flows_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_managers" ADD CONSTRAINT "production_managers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_managers" ADD CONSTRAINT "production_managers_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_managers" ADD CONSTRAINT "production_managers_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "production_flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_manager_users" ADD CONSTRAINT "production_manager_users_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "production_managers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_manager_users" ADD CONSTRAINT "production_manager_users_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_collaborators" ADD CONSTRAINT "production_collaborators_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_collaborators" ADD CONSTRAINT "production_collaborators_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_task_types" ADD CONSTRAINT "production_task_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_task_steps" ADD CONSTRAINT "production_task_steps_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "production_task_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_task_steps" ADD CONSTRAINT "production_task_steps_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "production_managers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_vehicles" ADD CONSTRAINT "production_vehicles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_project_history" ADD CONSTRAINT "production_project_history_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "production_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "production_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "production_task_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "production_task_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_tasks" ADD CONSTRAINT "production_tasks_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "production_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_time_entries" ADD CONSTRAINT "production_time_entries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "production_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_time_entries" ADD CONSTRAINT "production_time_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_time_corrections" ADD CONSTRAINT "production_time_corrections_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "production_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_task_history" ADD CONSTRAINT "production_task_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "production_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_attachments" ADD CONSTRAINT "production_attachments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "production_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_attachment_versions" ADD CONSTRAINT "production_attachment_versions_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "production_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma pessoa trabalha numa tarefa por vez (GP-43): no máximo um trecho aberto
CREATE UNIQUE INDEX "production_time_entries_open_per_employee" ON "production_time_entries"("employeeId") WHERE "end" IS NULL;
