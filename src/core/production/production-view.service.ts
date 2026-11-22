import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  projectInstant,
  toProjectDateKey,
} from '../fiscal/utils/project-date.util';
import {
  ChainClock,
  ChainTask,
  ProductionChain,
  entryMinutes,
} from './engine/production-chain';
import {
  ProductionAccessService,
  ProductionViewer,
} from './production-access.service';
import {
  ProductionConfigService,
  SECTOR_SELECT,
  managerView,
  taskTypeView,
} from './production-config.service';
import { ProductionStorageService } from './storage/production-storage.service';

export const TASK_NOT_FOUND = 'Tarefa não encontrada';
export const PROJECT_NOT_FOUND = 'Projeto não encontrado';

/** O relógio da produção: agora, no fuso da empresa (São Paulo). */
export const productionClock = (now = new Date()): ChainClock => ({
  now,
  at: projectInstant,
  dayOf: toProjectDateKey,
});

/** A data gravada como dia (coluna date): o dia em UTC é o dia gravado. */
export const dayKey = (date: Date | null | undefined) =>
  date ? date.toISOString().slice(0, 10) : null;

const round1 = (value: number) => Math.round(value * 10) / 10;

const CHAIN_SELECT = {
  id: true,
  projectId: true,
  stageName: true,
  status: true,
  estimatedMinutes: true,
  dependsOn: true,
  releasedNext: true,
  scheduleDate: true,
  scheduleStart: true,
  scheduleMinutes: true,
  assigneeId: true,
  currentStepId: true,
  taskTypeId: true,
  sectorId: true,
  timeEntries: {
    select: { start: true, end: true, seconds: true, employeeId: true },
  },
  corrections: { select: { before: true, after: true } },
} satisfies Prisma.ProductionTaskSelect;

const DETAIL_SELECT = {
  id: true,
  code: true,
  projectId: true,
  quotationProductId: true,
  itemName: true,
  itemImage: true,
  stageName: true,
  sectorId: true,
  sectorName: true,
  taskTypeId: true,
  currentStepId: true,
  status: true,
  estimatedMinutes: true,
  setupMinutes: true,
  machine: true,
  machineQuality: true,
  baseTaskId: true,
  dependsOn: true,
  quantity: true,
  measureText: true,
  fields: true,
  consumption: true,
  note: true,
  scheduleDate: true,
  scheduleStart: true,
  scheduleMinutes: true,
  assigneeId: true,
  pendencyText: true,
  pendencyAt: true,
  pendencyBy: true,
  releasedNext: true,
  completedBy: true,
  completedAt: true,
  vehicleId: true,
  km: true,
  priority: true,
  timeEntries: {
    select: {
      id: true,
      employeeId: true,
      start: true,
      end: true,
      seconds: true,
      source: true,
      note: true,
    },
    orderBy: { start: 'asc' },
  },
  corrections: {
    select: {
      id: true,
      at: true,
      byName: true,
      entryId: true,
      before: true,
      after: true,
      note: true,
    },
    orderBy: { at: 'desc' },
  },
  attachments: {
    select: {
      id: true,
      name: true,
      kind: true,
      versions: {
        select: {
          version: true,
          fileName: true,
          size: true,
          mime: true,
          storageKey: true,
          uploadedBy: true,
          uploadedAt: true,
          current: true,
        },
        orderBy: { version: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  history: {
    select: { id: true, at: true, byName: true, text: true, kind: true },
    orderBy: { at: 'desc' },
  },
} satisfies Prisma.ProductionTaskSelect;

const PROJECT_SELECT = {
  id: true,
  companyId: true,
  quotationId: true,
  number: true,
  clientName: true,
  sellerName: true,
  approvedAt: true,
  deliveryType: true,
  firstDue: true,
  due: true,
  status: true,
} satisfies Prisma.ProductionProjectSelect;

const TYPE_SELECT = {
  id: true,
  name: true,
  release: true,
  timeControl: true,
  isActive: true,
  steps: {
    select: { id: true, name: true, managerId: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.ProductionTaskTypeSelect;

const MANAGER_SELECT = {
  id: true,
  name: true,
  flowId: true,
  timeMode: true,
  intervalMinutes: true,
  isActive: true,
  sector: { select: SECTOR_SELECT },
  users: { select: { employeeId: true, onlyAssigned: true } },
} satisfies Prisma.ProductionManagerSelect;

export type ChainRow = Prisma.ProductionTaskGetPayload<{
  select: typeof CHAIN_SELECT;
}>;
type DetailRow = Prisma.ProductionTaskGetPayload<{
  select: typeof DETAIL_SELECT;
}>;
export type ProjectRow = Prisma.ProductionProjectGetPayload<{
  select: typeof PROJECT_SELECT;
}>;
type TypeRow = Prisma.ProductionTaskTypeGetPayload<{
  select: typeof TYPE_SELECT;
}>;
export type ManagerRow = Prisma.ProductionManagerGetPayload<{
  select: typeof MANAGER_SELECT;
}>;
type Collaborator = Awaited<
  ReturnType<ProductionConfigService['collaborators']>
>[number];

/** O que uma leitura carrega de uma vez: projetos, tarefas e cadastro. */
export type ProductionContext = {
  viewer: ProductionViewer;
  chain: ProductionChain;
  rows: ChainRow[];
  rowsById: Map<string, ChainRow>;
  projects: Map<string, ProjectRow>;
  types: Map<string, TypeRow>;
  managers: Map<string, ManagerRow>;
  collaborators: Map<string, Collaborator>;
};

const correctionPeople = (value: unknown) => {
  const id = (value as { collaboratorId?: unknown } | null)?.collaboratorId;
  return typeof id === 'string' ? [id] : [];
};

export const projectView = (row: ProjectRow) => ({
  id: row.id,
  number: row.number,
  quotationId: row.quotationId,
  client: row.clientName,
  seller: row.sellerName,
  approvedAt: toProjectDateKey(row.approvedAt),
  deliveryType: row.deliveryType,
  firstDue: dayKey(row.firstDue),
  due: dayKey(row.due),
  status: row.status,
});

/**
 * A leitura da produção: monta a TaskView (o contrato do quadro, do
 * projeto e da agenda) com os derivados da cadeia, calculados em memória
 * sobre todas as tarefas dos projetos envolvidos, numa consulta só.
 */
@Injectable()
export class ProductionViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService,
    private readonly config: ProductionConfigService,
    private readonly storage: ProductionStorageService,
  ) {}

  async context(
    viewer: ProductionViewer,
    projectWhere: Prisma.ProductionProjectWhereInput,
    now = new Date(),
  ): Promise<ProductionContext> {
    const companyId = viewer.companyId;
    const projects = await this.prisma.productionProject.findMany({
      where: { ...projectWhere, companyId },
      select: PROJECT_SELECT,
    });
    const projectIds = projects.map((project) => project.id);
    const [rows, types, managers, collaborators, calendar] = await Promise.all([
      projectIds.length
        ? this.prisma.productionTask.findMany({
            where: { projectId: { in: projectIds } },
            select: CHAIN_SELECT,
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          })
        : Promise.resolve([] as ChainRow[]),
      this.prisma.productionTaskType.findMany({
        where: { companyId },
        select: TYPE_SELECT,
      }),
      this.prisma.productionManager.findMany({
        where: { companyId },
        select: MANAGER_SELECT,
      }),
      this.config.collaborators(companyId),
      this.config.calendar(companyId),
    ]);
    const projectMap = new Map(
      projects.map((project) => [project.id, project]),
    );
    const chain = new ProductionChain(
      rows.map((row) => this.chainTask(row)),
      new Map(
        projects.map((project) => [
          project.id,
          { id: project.id, status: project.status, due: dayKey(project.due)! },
        ]),
      ),
      { ...productionClock(now), calendar },
    );
    return {
      viewer,
      chain,
      rows,
      rowsById: new Map(rows.map((row) => [row.id, row])),
      projects: projectMap,
      types: new Map(types.map((type) => [type.id, type])),
      managers: new Map(managers.map((manager) => [manager.id, manager])),
      collaborators: new Map(
        collaborators.map((person) => [person.id, person]),
      ),
    };
  }

  chainTask(row: ChainRow): ChainTask {
    return {
      id: row.id,
      projectId: row.projectId,
      stageName: row.stageName,
      status: row.status,
      estimatedMinutes: row.estimatedMinutes,
      dependsOn: row.dependsOn,
      released: !!row.releasedNext,
      schedule:
        row.scheduleDate && row.scheduleStart && row.scheduleMinutes
          ? {
              date: dayKey(row.scheduleDate)!,
              start: row.scheduleStart,
              minutes: row.scheduleMinutes,
            }
          : null,
      entries: row.timeEntries,
    };
  }

  /**
   * A etapa atual, a posição dela no tipo e o gerenciador. Sem a etapa (saiu
   * do tipo depois de a tarefa fechar), vale a última do tipo.
   */
  stepOf(
    ctx: ProductionContext,
    row: { taskTypeId: string; currentStepId: string | null },
  ) {
    const steps = ctx.types.get(row.taskTypeId)?.steps ?? [];
    let index = steps.findIndex((step) => step.id === row.currentStepId);
    if (index < 0) index = steps.length - 1;
    const step = index >= 0 ? steps[index] : null;
    return {
      step,
      stepIndex: Math.max(index, 0),
      nextStep: index >= 0 ? (steps[index + 1] ?? null) : null,
      managerId: step?.managerId ?? null,
    };
  }

  workerIds(row: ChainRow) {
    return row.timeEntries
      .filter((entry) => !entry.end)
      .map((entry) => entry.employeeId);
  }

  visible(ctx: ProductionContext, row: ChainRow) {
    return this.access.canSee(ctx.viewer, {
      managerId: this.stepOf(ctx, row).managerId,
      assigneeId: row.assigneeId,
      workerIds: this.workerIds(row),
      affectedIds: row.corrections.flatMap((correction) => [
        ...correctionPeople(correction.before),
        ...correctionPeople(correction.after),
      ]),
    });
  }

  private person(ctx: ProductionContext, id: string | null) {
    const person = id ? ctx.collaborators.get(id) : null;
    return person
      ? {
          id: person.id,
          name: person.name,
          role: person.role,
          working: person.working,
        }
      : null;
  }

  /** As TaskViews das tarefas pedidas, na ordem pedida. */
  async views(ctx: ProductionContext, ids: string[]) {
    if (!ids.length) return [];
    const details = await this.prisma.productionTask.findMany({
      where: { id: { in: ids } },
      select: DETAIL_SELECT,
    });
    const byId = new Map(details.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is DetailRow => !!row)
      .map((row) => this.view(ctx, row));
  }

  private view(ctx: ProductionContext, row: DetailRow) {
    const chainRow = ctx.rowsById.get(row.id)!;
    const chainTask = ctx.chain.task(row.id)!;
    const project = ctx.projects.get(row.projectId)!;
    const type = ctx.types.get(row.taskTypeId);
    const { step, stepIndex, managerId } = this.stepOf(ctx, row);
    const manager = managerId ? ctx.managers.get(managerId) : null;
    const { blocked, blockedBy } = ctx.chain.blocking(chainTask);
    const now = new Date();
    const releasedNext = row.releasedNext as {
      at: string;
      by: string;
      quantity: number | null;
      of: number | null;
    } | null;
    return {
      id: row.id,
      code: row.code,
      projectId: row.projectId,
      quotationItemId: row.quotationProductId,
      itemName: row.itemName,
      itemImage: row.itemImage,
      stageName: row.stageName,
      // O setor do gerenciador da etapa atual: a cor e o ícone da tarefa
      sector: manager?.sector ?? {
        id: row.sectorId,
        name: row.sectorName,
        icon: null,
        color: null,
      },
      // O setor da etapa na composição (a produtividade agrupa por ele)
      originSector: { id: row.sectorId, name: row.sectorName },
      taskTypeId: row.taskTypeId,
      stepIndex,
      status: row.status,
      estimatedMinutes: row.estimatedMinutes,
      setupMinutes: row.setupMinutes,
      machine: row.machine,
      machineQuality: row.machineQuality,
      baseTaskId: row.baseTaskId,
      dependsOn: row.dependsOn,
      releasedNext,
      quantity: row.quantity,
      measureText: row.measureText,
      fields: row.fields,
      consumption: row.consumption,
      note: row.note,
      schedule: chainTask.schedule,
      assigneeId: row.assigneeId,
      pendency: row.pendencyText
        ? {
            text: row.pendencyText,
            at: row.pendencyAt?.toISOString() ?? null,
            by: row.pendencyBy ?? '',
          }
        : null,
      timeEntries: row.timeEntries.map((entry) => ({
        id: entry.id,
        collaboratorId: entry.employeeId,
        start: entry.start.toISOString(),
        end: entry.end?.toISOString() ?? null,
        minutes: round1(entryMinutes(entry, now)),
        source: entry.source,
        note: entry.note,
      })),
      corrections: row.corrections.map((correction) => ({
        id: correction.id,
        at: correction.at.toISOString(),
        by: correction.byName,
        entryId: correction.entryId,
        before: correction.before,
        after: correction.after,
        note: correction.note,
      })),
      attachments: row.attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        kind: attachment.kind,
        versions: attachment.versions.map((version) => ({
          version: version.version,
          fileName: version.fileName,
          size: version.size,
          mime: version.mime,
          uploadedBy: version.uploadedBy,
          uploadedAt: version.uploadedAt.toISOString(),
          current: version.current,
          url: this.storage.signedUrl(version.storageKey, now),
        })),
      })),
      history: row.history.map((entry) => ({
        id: entry.id,
        at: entry.at.toISOString(),
        by: entry.byName,
        text: entry.text,
        kind: entry.kind,
      })),
      // O balão do cartão conta os comentários da equipe (VS-5)
      comments: row.history.filter((entry) => entry.kind === 'COMMENT').length,
      priority: row.priority,
      completedBy: row.completedBy,
      completedAt: row.completedAt?.toISOString() ?? null,
      vehicleId: row.vehicleId,
      km: row.km,
      project: projectView(project),
      taskType: type ? taskTypeView(type) : null,
      step,
      managerId,
      blocked,
      blockedBy,
      assignee: this.person(ctx, row.assigneeId),
      workers: this.workerIds(chainRow)
        .map((id) => this.person(ctx, id))
        .filter(Boolean),
      actualMinutes: ctx.chain.actualMinutes(chainTask),
      late: ctx.chain.late(chainTask),
      alert: ctx.chain.alert(chainTask),
    };
  }

  managerSummaryView(row: ManagerRow) {
    const view = managerView({ ...row, users: row.users });
    return {
      id: view.id,
      name: view.name,
      sector: view.sector,
      timeMode: view.timeMode,
      intervalMinutes: view.intervalMinutes,
      active: view.active,
    };
  }
}
