import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { toProjectDateKey } from '../fiscal/utils/project-date.util';
import { PlanControlService } from '../plan/plan-control.service';
import { UNIT_SYMBOL } from '../material/material-text';
import { itemProductName } from '../sale/quotation/item-origin';
import {
  PlanItem,
  PlanMachineSetup,
  PlanStage,
  PlanTaskType,
  PlannedTask,
  planTasks,
  stageSectors,
  typeFor,
} from './engine/production-plan';
import { ProductionViewer } from './production-access.service';
import { DEFAULT_FLOW } from './production-config.service';
import { cancelProjectInTx, moveScheduleInTx } from './production-follow';
import { ProductionMirrorService } from './production-mirror.service';
import {
  PROJECT_NOT_FOUND,
  ProductionViewService,
  dayKey,
  projectView,
} from './production-view.service';
import { consumeSale } from '../stock/stock-consumption';

// O projeto nasce também na tela por setor do PRO (GP-46, GP-47)
export const PRODUCTION_FEATURE = ['production_manager', 'sector_board'];
const DEFAULT_TYPE = 'Produção';
/** O tipo de tarefa do setor no PRO (GP-49): a chave não casa com nome */
export const SECTOR_TYPE_PREFIX = 'setor:';
const SYSTEM = 'sistema';
const PROJECT_CLOSED = 'O projeto já foi encerrado';

const DELIVERY_LABELS: Record<string, string> = {
  INSTALLATION: 'Entrega na instalação',
  CARRIER: 'Transportadora',
  PICKUP: 'Cliente retira',
};

const brDate = (day: string | null) =>
  day ? day.split('-').reverse().join('/') : '';

/** O dia (YYYY-MM-DD) para a coluna date. */
export const dateColumn = (day: string) => new Date(`${day}T00:00:00.000Z`);

const addDays = (day: string, days: number) => {
  const date = dateColumn(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** O código curto da tarefa (o legado usa "C7E12"), único no projeto. */
const shortCode = (taken: Set<string>) => {
  for (;;) {
    const code = randomBytes(3).toString('hex').slice(0, 5).toUpperCase();
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
};

/** A etapa do retrato (ORC-10), como a geração lê. */
type SnapshotStage = Partial<PlanStage> & {
  blockId?: string;
  name?: string;
  sector?: string;
  setupMinutes?: number;
  lines?: PlanStage['lines'];
};

/** As caixas de dentro da parte no retrato (FL-10), como o plano lê. */
const partsOf = (parts: unknown): PlanStage[] | null =>
  Array.isArray(parts) && parts.length
    ? (parts as SnapshotStage[])
        .filter((part) => part.blockId)
        .map((part) => ({
          blockId: part.blockId!,
          name: part.name ?? '',
          sector: part.sector ?? '',
          sectorId: part.sectorId ?? null,
          taskType: part.taskType ?? '',
          dependsOn: Array.isArray(part.dependsOn) ? part.dependsOn : [],
          baseBlockId: part.baseBlockId ?? null,
          fields: [],
          note: null,
          setupMinutes: Number(part.setupMinutes) || 0,
          lines: Array.isArray(part.lines) ? part.lines : [],
          parts: partsOf(part.parts),
        }))
    : null;

const QUOTATION_SELECT = {
  id: true,
  companyId: true,
  status: true,
  approvedAt: true,
  quotationNumber: true,
  series: { select: { code: true } },
  client: { select: { name: true } },
  seller: { select: { name: true, user: { select: { name: true } } } },
  deliveryInfo: {
    select: {
      deliveryType: true,
      estimatedDate: true,
      deliverySchedule: { select: { scheduledDate: true } },
    },
  },
  DeliverySchedule: { select: { scheduledDate: true } },
  quotationProduct: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      quantity: true,
      description: true,
      imageUrl: true,
      composition: true,
      product: { select: { name: true, imageUrl: true } },
      material: { select: { name: true } },
      materialVariation: { select: { brand: true, color: true } },
      items: { select: { width: true, height: true }, take: 1 },
      snapshot: { select: { data: true } },
      lines: {
        where: { kind: 'PROCESS' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          sector: true,
          resolved: true,
          process: {
            select: { taskType: true, sectorId: true, setupMinutes: true },
          },
        },
      },
    },
  },
} satisfies Prisma.QuotationSelect;

type ApprovedQuotation = Prisma.QuotationGetPayload<{
  select: typeof QUOTATION_SELECT;
}>;

/**
 * O projeto de produção (PCP-4, GP-8): nasce da venda aprovada da empresa
 * com o gerenciador de produção (ELITE), uma tarefa por etapa do retrato da
 * composição de cada item. Liberar, concluir, cancelar e mudar a entrega.
 */
@Injectable()
export class ProductionProjectService {
  private readonly logger = new Logger(ProductionProjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: PlanControlService,
    private readonly view: ProductionViewService,
    private readonly mirror: ProductionMirrorService,
  ) {}

  /* --------------------------------------------- nasce da venda aprovada */

  /**
   * Cria o projeto da venda aprovada, se a empresa tem o gerenciador e a
   * venda ainda não tem projeto: reaprovar e reprocessar não duplicam. Sem
   * item com composição, não há projeto (GP-41).
   */
  async ensureFromQuotation(quotationId: string): Promise<void> {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      select: QUOTATION_SELECT,
    });
    if (!quotation || quotation.status !== 'APPROVED') return;
    if (
      !(await this.plan.hasFeature(quotation.companyId, PRODUCTION_FEATURE))
    ) {
      return;
    }
    const existing = await this.prisma.productionProject.count({
      where: { quotationId },
    });
    if (existing) return;

    const items = await this.planItems(quotation);
    if (!items.some((item) => item.stages.length)) return;

    const companyId = quotation.companyId;
    const planned = await this.planFor(companyId, items);
    if (!planned.length) return;

    const ids = new Map<string, string>(
      planned.map((task) => [task.key, randomUUID()]),
    );
    const codes = new Set<string>();
    const approvedAt = quotation.approvedAt ?? new Date();
    const due = this.dueOf(quotation, approvedAt);
    const projectId = randomUUID();
    try {
      await this.prisma.$transaction([
        this.prisma.productionProject.create({
          data: {
            id: projectId,
            companyId,
            quotationId,
            number: this.numberOf(quotation),
            clientName: quotation.client?.name ?? '',
            sellerName:
              quotation.seller?.name || quotation.seller?.user?.name || '',
            approvedAt,
            deliveryType:
              DELIVERY_LABELS[quotation.deliveryInfo?.deliveryType ?? ''] ?? '',
            firstDue: dateColumn(due),
            due: dateColumn(due),
            history: {
              create: {
                byName: SYSTEM,
                text: `Projeto criado da venda aprovada, com ${planned.length} tarefa(s)`,
              },
            },
          },
        }),
        this.prisma.productionTask.createMany({
          data: planned.map((task, position) => ({
            id: ids.get(task.key)!,
            companyId,
            projectId,
            code: shortCode(codes),
            taskTypeId: task.taskTypeId,
            currentStepId: task.currentStepId,
            position,
            ...this.taskContent(task, ids),
          })),
        }),
      ]);
    } catch (error) {
      // Duas aprovações ao mesmo tempo: a outra criou
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
  }

  /** O que a tarefa traz do retrato: refeito quando a O.S. muda. */
  private taskContent(task: PlannedTask, ids: Map<string, string>) {
    return {
      quotationProductId: task.itemId,
      stageKey: task.stageKey,
      itemName: task.itemName,
      itemImage: task.itemImage,
      stageName: task.stageName,
      sectorId: task.sectorId,
      sectorName: task.sectorName,
      estimatedMinutes: task.estimatedMinutes,
      setupMinutes: task.setupMinutes,
      machine: task.machine,
      machineSetupId: task.machineSetupId,
      machineQuality: task.machineQuality,
      baseTaskId: task.baseKey ? (ids.get(task.baseKey) ?? null) : null,
      dependsOn: task.dependsOnKeys
        .map((key) => ids.get(key))
        .filter((id): id is string => !!id),
      quantity: task.quantity,
      measureText: task.measureText,
      fields: task.fields,
      consumption: task.consumption as Prisma.InputJsonValue,
      note: task.note,
    };
  }

  /** As tarefas dos itens: o tipo pelo nome da etapa, ou o padrão. */
  private async planFor(companyId: string, items: PlanItem[]) {
    // O tipo do setor do PRO não casa pelo nome (no ELITE, vale o cadastro)
    const types = await this.prisma.productionTaskType.findMany({
      where: {
        companyId,
        isActive: true,
        NOT: { nameKey: { startsWith: SECTOR_TYPE_PREFIX } },
      },
      select: {
        id: true,
        name: true,
        release: true,
        steps: {
          select: { id: true },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          take: 1,
        },
      },
    });
    const planTypes: PlanTaskType[] = types.map((type) => ({
      id: type.id,
      name: type.name,
      release: type.release,
      firstStepId: type.steps[0]?.id ?? null,
    }));
    // O gerenciador do tipo padrão segue o setor das etapas que caem nele
    const none: PlanTaskType = {
      id: '',
      name: '',
      release: 'AFTER_BASE',
      firstStepId: null,
    };
    const sectorIds = items
      .flatMap((item) => item.stages)
      .filter((stage) => typeFor(stage, planTypes, none) === none)
      .map((stage) => stage.sectorId)
      .filter((id): id is string => !!id);
    const elite = await this.plan.hasFeature(companyId, 'production_manager');
    const bySector = elite
      ? null
      : await this.sectorTypes(
          companyId,
          stageSectors(items.flatMap((item) => item.stages)),
        );
    // No PRO, só a etapa sem setor cai no tipo padrão
    const [fallback, setups] = await Promise.all([
      !bySector || items.some((item) => this.hasStageWithoutSector(item.stages))
        ? this.fallbackType(companyId, sectorIds)
        : Promise.resolve(none),
      this.machineSetups(companyId),
    ]);
    return planTasks(
      items,
      planTypes,
      fallback,
      setups,
      bySector
        ? (stage) => (stage.sectorId ? bySector.get(stage.sectorId) : undefined)
        : undefined,
    );
  }

  private hasStageWithoutSector(stages: PlanItem['stages']): boolean {
    return stages.some(
      (stage) =>
        (!stage.parts?.length && !stage.sectorId) ||
        (!!stage.parts?.length && this.hasStageWithoutSector(stage.parts)),
    );
  }

  /**
   * O PRO sem gerenciadores cadastrados (GP-49, 22/11/2026): o setor é o
   * ícone do fluxo. Cada setor da composição tem a sua tela, criada sozinha
   * na primeira venda (o gerenciador do setor no modo sem tempo, com o
   * expediente da empresa) e um tipo de tarefa próprio com uma etapa nela.
   * O gerenciador que a empresa já tem para o setor é reaproveitado.
   */
  private async sectorTypes(
    companyId: string,
    sectors: Map<string, string>,
  ): Promise<Map<string, PlanTaskType>> {
    const result = new Map<string, PlanTaskType>();
    if (!sectors.size) return result;
    const keys = [...sectors.keys()].map((id) => SECTOR_TYPE_PREFIX + id);
    const existing = await this.prisma.productionTaskType.findMany({
      where: { companyId, nameKey: { in: keys } },
      select: {
        nameKey: true,
        id: true,
        name: true,
        release: true,
        steps: {
          select: { id: true },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          take: 1,
        },
      },
    });
    for (const type of existing) {
      if (!type.steps[0]) continue;
      result.set(type.nameKey.slice(SECTOR_TYPE_PREFIX.length), {
        id: type.id,
        name: type.name,
        release: type.release,
        firstStepId: type.steps[0].id,
      });
    }
    const missing = [...sectors.keys()].filter((id) => !result.has(id));
    if (!missing.length) return result;
    const [rows, calendar] = await Promise.all([
      this.prisma.companySector.findMany({
        where: { id: { in: missing }, companyId },
        select: { id: true, name: true },
      }),
      this.prisma.productionCalendar.findUnique({
        where: { companyId },
        select: {
          startTime: true,
          endTime: true,
          breakStart: true,
          breakEnd: true,
        },
      }),
    ]);
    let flowId: string | null = null;
    for (const sector of rows) {
      let created = false;
      // Não há índice único de empresa e setor no gerenciador: duas
      // primeiras vendas ao mesmo tempo se enfileiram nesta trava, e a
      // segunda acha a tela e o tipo que a primeira criou
      const type = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-sector:${companyId}:${sector.id}`}))`;
        const nameKey = SECTOR_TYPE_PREFIX + sector.id;
        const select = {
          id: true,
          name: true,
          release: true,
          steps: {
            select: { id: true },
            orderBy: [
              { position: 'asc' as const },
              { createdAt: 'asc' as const },
            ],
            take: 1,
          },
        };
        const existing = await tx.productionTaskType.findUnique({
          where: { companyId_nameKey: { companyId, nameKey } },
          select,
        });
        if (existing?.steps[0]) return existing;
        let managerId = (
          await tx.productionManager.findFirst({
            where: { companyId, sectorId: sector.id, isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })
        )?.id;
        if (!managerId) {
          flowId ??= await this.defaultFlowId(companyId, tx);
          managerId = (
            await tx.productionManager.create({
              data: {
                companyId,
                name: sector.name,
                sectorId: sector.id,
                flowId,
                timeMode: 'NONE',
                workStart: calendar?.startTime ?? '08:00',
                workEnd: calendar?.endTime ?? '18:00',
                breakStart: calendar?.breakStart ?? null,
                breakEnd: calendar?.breakEnd ?? null,
              },
              select: { id: true },
            })
          ).id;
          created = true;
        }
        return tx.productionTaskType.upsert({
          where: { companyId_nameKey: { companyId, nameKey } },
          create: {
            companyId,
            name: sector.name,
            nameKey,
            release: 'AFTER_BASE',
            timeControl: false,
            steps: {
              create: { name: sector.name, managerId, position: 0 },
            },
          },
          update: {},
          select,
        });
      });
      if (created) {
        this.logger.log(
          `Tela do setor "${sector.name}" criada na empresa ${companyId}`,
        );
      }
      result.set(sector.id, {
        id: type.id,
        name: type.name,
        release: type.release,
        firstStepId: type.steps[0]?.id ?? null,
      });
    }
    return result;
  }

  private async defaultFlowId(
    companyId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const existing = await db.productionFlow.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) return existing.id;
    return (
      await db.productionFlow.upsert({
        where: { companyId_name: { companyId, name: DEFAULT_FLOW } },
        create: { companyId, name: DEFAULT_FLOW },
        update: {},
        select: { id: true },
      })
    ).id;
  }

  /** As qualidades das máquinas, com o tempo por unidade (GP-48 item 22). */
  private async machineSetups(companyId: string): Promise<PlanMachineSetup[]> {
    const setups = await this.prisma.assetSetup.findMany({
      where: { asset: { companyId } },
      select: {
        id: true,
        name: true,
        unit: true,
        timePerUnit: true,
        asset: { select: { name: true, groupId: true } },
      },
    });
    return setups.map((setup) => ({
      id: setup.id,
      name: setup.name,
      assetName: setup.asset.name,
      groupId: setup.asset.groupId,
      unit: UNIT_SYMBOL[setup.unit],
      timePerUnit: setup.timePerUnit,
    }));
  }

  /**
   * A O.S. aprovada alterada (plano sem estoque, PO 14/10/2026): as
   * tarefas do item acompanham o retrato novo. A que continua é refeita
   * (tempo, consumo, medida) sem perder estado nem apontamento; a etapa
   * nova vira tarefa; a que saiu é cancelada, com o histórico.
   */
  async syncItem(quotationProductId: string): Promise<void> {
    const row = await this.prisma.quotationProduct.findUnique({
      where: { id: quotationProductId },
      select: { quotationId: true },
    });
    if (!row) return;
    const project = await this.prisma.productionProject.findUnique({
      where: { quotationId: row.quotationId },
      select: { id: true, companyId: true, status: true },
    });
    if (!project || !['STANDBY', 'PRODUCTION'].includes(project.status)) {
      return;
    }
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: row.quotationId },
      select: QUOTATION_SELECT,
    });
    const items = await this.planItems({
      ...quotation!,
      quotationProduct: quotation!.quotationProduct.filter(
        (item) => item.id === quotationProductId,
      ),
    });
    const planned = items.some((item) => item.stages.length)
      ? await this.planFor(project.companyId, items)
      : [];
    const [existing, codes] = await Promise.all([
      this.prisma.productionTask.findMany({
        where: { projectId: project.id, quotationProductId },
        select: {
          id: true,
          stageKey: true,
          status: true,
          estimatedMinutes: true,
          measureText: true,
        },
      }),
      this.prisma.productionTask.findMany({
        where: { projectId: project.id },
        select: { code: true, position: true },
      }),
    ]);
    const byKey = new Map(existing.map((task) => [task.stageKey, task]));
    const ids = new Map<string, string>(
      planned.map((task) => [
        task.key,
        byKey.get(task.stageKey)?.id ?? randomUUID(),
      ]),
    );
    const taken = new Set(codes.map((task) => task.code));
    let position = Math.max(-1, ...codes.map((task) => task.position)) + 1;
    const kept = new Set(planned.map((task) => task.stageKey));
    const removed = existing.filter(
      (task) =>
        !kept.has(task.stageKey) && !['DONE', 'CANCELED'].includes(task.status),
    );
    const now = new Date();
    let changed = 0;
    let added = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const task of planned) {
        const current = byKey.get(task.stageKey);
        const content = this.taskContent(task, ids);
        if (current) {
          await tx.productionTask.update({
            where: { id: current.id },
            data: content,
          });
          if (
            current.estimatedMinutes !== task.estimatedMinutes ||
            current.measureText !== task.measureText
          ) {
            changed++;
            await tx.productionTaskHistory.create({
              data: {
                taskId: current.id,
                byName: SYSTEM,
                text: `A O.S. foi alterada: ${task.measureText}, ${task.estimatedMinutes} min previstos`,
              },
            });
          }
          continue;
        }
        added++;
        await tx.productionTask.create({
          data: {
            id: ids.get(task.key)!,
            companyId: project.companyId,
            projectId: project.id,
            code: shortCode(taken),
            taskTypeId: task.taskTypeId,
            currentStepId: task.currentStepId,
            position: position++,
            ...content,
            history: {
              create: { byName: SYSTEM, text: 'Etapa nova da O.S. alterada' },
            },
          },
        });
      }
      for (const task of removed) {
        const open = await tx.productionTimeEntry.findMany({
          where: { taskId: task.id, end: null },
          select: { id: true, start: true },
        });
        for (const entry of open) {
          await tx.productionTimeEntry.update({
            where: { id: entry.id },
            data: {
              end: now,
              seconds: Math.max(
                0,
                Math.round((now.getTime() - entry.start.getTime()) / 1000),
              ),
            },
          });
        }
        await tx.productionTask.update({
          where: { id: task.id },
          data: { status: 'CANCELED' },
        });
        await tx.productionTaskHistory.create({
          data: {
            taskId: task.id,
            byName: SYSTEM,
            text: 'Cancelada: a etapa saiu da O.S. alterada',
          },
        });
      }
      if (changed || added || removed.length) {
        await tx.productionProjectHistory.create({
          data: {
            projectId: project.id,
            byName: SYSTEM,
            text: `O.S. alterada (${items[0]?.itemName ?? 'item'}): ${changed} tarefa(s) refeita(s), ${added} nova(s), ${removed.length} cancelada(s)`,
          },
        });
      }
    });
    await this.mirror.sync(project.id);
  }

  /** O resumo do projeto para a resposta da aprovação. */
  async summaryOf(quotationId: string) {
    const project = await this.prisma.productionProject.findUnique({
      where: { quotationId },
      select: { id: true, status: true, _count: { select: { tasks: true } } },
    });
    return project
      ? { id: project.id, tasks: project._count.tasks, status: project.status }
      : null;
  }

  private numberOf(quotation: ApprovedQuotation) {
    const number = quotation.quotationNumber ?? '';
    return quotation.series?.code
      ? `${number}-${quotation.series.code}`
      : String(number);
  }

  /**
   * A data da agenda de entrega, ou a prevista. A venda sem prazo nasce
   * com a agenda no dia da aprovação: aí vale aprovação + 7 dias.
   */
  private dueOf(quotation: ApprovedQuotation, approvedAt: Date) {
    const approvedDay = toProjectDateKey(approvedAt);
    const candidate =
      quotation.DeliverySchedule?.scheduledDate ??
      quotation.deliveryInfo?.deliverySchedule?.scheduledDate ??
      quotation.deliveryInfo?.estimatedDate;
    const day = candidate ? toProjectDateKey(candidate) : null;
    return day && day > approvedDay ? day : addDays(approvedDay, 7);
  }

  /**
   * Os itens com o retrato da composição, mais os processos acrescentados
   * dentro do item (ORC-5). O retrato antigo, sem o tipo de tarefa e o
   * fluxo, completa pelo cadastro da etapa.
   */
  private async planItems(quotation: ApprovedQuotation): Promise<PlanItem[]> {
    const raw = quotation.quotationProduct.map((item) => {
      const data = item.snapshot?.data as {
        stages?: SnapshotStage[];
        measure?: { quantity?: number; width?: number; height?: number };
      } | null;
      return {
        item,
        stages: Array.isArray(data?.stages) ? data!.stages : [],
        measure: data?.measure,
      };
    });
    const missing = raw.flatMap(({ stages }) =>
      stages
        .filter((stage) => stage.blockId && stage.taskType === undefined)
        .map((stage) => stage.blockId!),
    );
    const blocks = missing.length
      ? await this.prisma.assemblyBlock.findMany({
          where: { id: { in: missing } },
          select: {
            id: true,
            type: true,
            taskType: true,
            localTaskType: true,
            sectorId: true,
            dependsOn: true,
            baseBlockId: true,
            process: { select: { taskType: true, sectorId: true } },
          },
        })
      : [];
    const blockOf = new Map(blocks.map((block) => [block.id, block]));

    return raw.map(({ item, stages, measure }) => {
      const notes =
        (
          item.composition as {
            notes?: { blockId: string; text: string }[];
          } | null
        )?.notes ?? [];
      const planStages: PlanStage[] = stages
        .filter((stage) => stage.blockId)
        .map((stage) => {
          const block = blockOf.get(stage.blockId!);
          return {
            blockId: stage.blockId!,
            name: stage.name ?? '',
            sector: stage.sector ?? '',
            sectorId:
              stage.sectorId ??
              block?.sectorId ??
              block?.process?.sectorId ??
              null,
            taskType:
              stage.taskType ??
              (block?.type === 'PROCESS' && block.process
                ? (block.localTaskType ?? block.process.taskType)
                : (block?.taskType ?? '')),
            dependsOn: stage.dependsOn ?? block?.dependsOn ?? [],
            baseBlockId: stage.baseBlockId ?? block?.baseBlockId ?? null,
            fields: Array.isArray(stage.fields) ? stage.fields : [],
            note:
              stage.note ??
              (notes
                .find((note) => note.blockId === stage.blockId)
                ?.text.trim() ||
                null),
            setupMinutes: Number(stage.setupMinutes) || 0,
            lines: Array.isArray(stage.lines) ? stage.lines : [],
            parts: partsOf(stage.parts),
          };
        });
      // O processo acrescentado no item: uma etapa a mais, sobre a base
      const base = planStages.find((stage) => !stage.dependsOn.length);
      for (const line of item.lines) {
        planStages.push({
          blockId: `line:${line.id}`,
          name: line.name,
          sector: line.sector,
          sectorId: line.process?.sectorId ?? null,
          taskType: line.process?.taskType ?? '',
          dependsOn: base ? [base.blockId] : [],
          baseBlockId: base?.blockId ?? null,
          fields: [],
          note: null,
          setupMinutes: line.process?.setupMinutes ?? 0,
          lines: Array.isArray(line.resolved)
            ? (line.resolved as PlanStage['lines'])
            : [],
        });
      }
      return {
        itemId: item.id,
        itemName: itemProductName(item) || 'Item',
        itemImage: item.imageUrl || item.product?.imageUrl || null,
        measure: {
          quantity: measure?.quantity || item.quantity || 1,
          width: measure?.width || item.items[0]?.width || null,
          height: measure?.height || item.items[0]?.height || null,
        },
        stages: planStages,
      };
    });
  }

  /**
   * O tipo padrão "Produção" (contrato): o da empresa, ou criado com uma
   * etapa no gerenciador do setor das etapas (ou no primeiro ativo). Sem
   * gerenciador ativo, o projeto não nasce e o reprocesso tenta de novo.
   */
  private async fallbackType(
    companyId: string,
    sectorIds: string[],
  ): Promise<PlanTaskType> {
    const select = {
      id: true,
      name: true,
      release: true,
      steps: {
        select: { id: true },
        orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }],
        take: 1,
      },
    };
    const toPlan = (
      type: Prisma.ProductionTaskTypeGetPayload<{ select: typeof select }>,
    ) => ({
      id: type.id,
      name: type.name,
      release: type.release,
      firstStepId: type.steps[0]?.id ?? null,
    });
    const nameKey = DEFAULT_TYPE.toLocaleLowerCase('pt-BR');
    const existing = await this.prisma.productionTaskType.findUnique({
      where: { companyId_nameKey: { companyId, nameKey } },
      select,
    });
    if (existing) return toPlan(existing);
    const managers = await this.prisma.productionManager.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, sectorId: true },
    });
    const manager =
      managers.find((item) => sectorIds.includes(item.sectorId)) ?? managers[0];
    if (!manager) {
      throw new Error(
        'Nenhum gerenciador de produção ativo: cadastre um em Configurações › Produção e reprocesse a aprovação',
      );
    }
    const created = await this.prisma.productionTaskType.upsert({
      where: { companyId_nameKey: { companyId, nameKey } },
      create: {
        companyId,
        name: DEFAULT_TYPE,
        nameKey,
        release: 'AFTER_BASE',
        timeControl: true,
        steps: {
          create: { name: DEFAULT_TYPE, managerId: manager.id, position: 0 },
        },
      },
      update: {},
      select,
    });
    this.logger.log(
      `Tipo de tarefa padrão "${DEFAULT_TYPE}" criado na empresa ${companyId}`,
    );
    return toPlan(created);
  }

  /* --------------------------------------------------------- leituras */

  async list(
    viewer: ProductionViewer,
    query: { status?: string; search?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const search = query.search?.trim();
    const where: Prisma.ProductionProjectWhereInput = {
      companyId: viewer.companyId,
      ...(query.status
        ? {
            status:
              query.status as Prisma.EnumProductionProjectStatusFilter['equals'],
          }
        : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { clientName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.productionProject.count({ where }),
      this.prisma.productionProject.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true },
      }),
    ]);
    const ids = rows.map((row) => row.id);
    const ctx = await this.view.context(viewer, { id: { in: ids } });
    const tasks = ctx.rows.map((row) => ctx.chain.task(row.id)!);
    return {
      data: ids.map((id) => ({
        ...projectView(ctx.projects.get(id)!),
        ...ctx.chain.projectSummary(id, tasks),
      })),
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }

  async quantity(companyId: string) {
    const groups = await this.prisma.productionProject.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { _all: true },
    });
    const result = { STANDBY: 0, PRODUCTION: 0, DONE: 0, CANCELED: 0 };
    for (const group of groups) result[group.status] = group._count._all;
    return result;
  }

  async detail(viewer: ProductionViewer, id: string) {
    const ctx = await this.view.context(viewer, { id });
    if (!ctx.projects.has(id)) throw new NotFoundException(PROJECT_NOT_FOUND);
    const own = ctx.rows.filter((row) => row.projectId === id);
    const visible = own.filter((row) => this.view.visible(ctx, row));
    const summary = ctx.chain.projectSummary(
      id,
      own.map((row) => ctx.chain.task(row.id)!),
    );
    const history = await this.prisma.productionProjectHistory.findMany({
      where: { projectId: id },
      orderBy: { at: 'desc' },
      select: { id: true, at: true, byName: true, text: true },
    });
    return {
      project: projectView(ctx.projects.get(id)!),
      late: summary.late,
      risk: summary.risk,
      tasks: await this.view.views(
        ctx,
        visible.map((row) => row.id),
      ),
      hidden: own.length - visible.length,
      history: history.map((entry) => ({
        id: entry.id,
        at: entry.at.toISOString(),
        by: entry.byName,
        text: entry.text,
      })),
    };
  }

  /* ------------------------------------------------------ mudanças */

  private async projectOf(companyId: string, id: string) {
    const project = await this.prisma.productionProject.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        quotationId: true,
        status: true,
        firstDue: true,
        due: true,
      },
    });
    if (!project) throw new NotFoundException(PROJECT_NOT_FOUND);
    return project;
  }

  /**
   * Libera a produção (GP-8): a tarefa de tipo "já nasce concluída" fecha
   * pela regra do tipo (GP-13).
   */
  async release(viewer: ProductionViewer, id: string) {
    const project = await this.projectOf(viewer.companyId, id);
    if (project.status !== 'STANDBY') {
      throw new ConflictException(
        project.status === 'PRODUCTION'
          ? 'A produção deste projeto já foi liberada'
          : PROJECT_CLOSED,
      );
    }
    const autoDone = await this.prisma.productionTask.findMany({
      where: {
        projectId: id,
        status: 'NOT_STARTED',
        taskType: { release: 'DONE' },
      },
      select: { id: true },
    });
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.productionProject.update({
        where: { id },
        data: {
          status: 'PRODUCTION',
          history: {
            create: {
              byUserId: viewer.userId,
              byName: viewer.name,
              text: 'Liberou a produção',
            },
          },
        },
      }),
      this.prisma.productionTask.updateMany({
        where: { id: { in: autoDone.map((task) => task.id) } },
        data: { status: 'DONE', completedBy: SYSTEM, completedAt: now },
      }),
      this.prisma.productionTaskHistory.createMany({
        data: autoDone.map((task) => ({
          taskId: task.id,
          byUserId: viewer.userId,
          byName: viewer.name,
          text: 'Nasceu concluída pela regra do tipo de tarefa',
        })),
      }),
    ]);
    await this.mirror.sync(id);
    return { id, status: 'PRODUCTION', autoDone: autoDone.length };
  }

  async finish(viewer: ProductionViewer, id: string) {
    const project = await this.projectOf(viewer.companyId, id);
    if (project.status === 'DONE' || project.status === 'CANCELED') {
      throw new ConflictException(PROJECT_CLOSED);
    }
    const open = await this.prisma.productionTask.count({
      where: { projectId: id, status: { notIn: ['DONE', 'CANCELED'] } },
    });
    if (open) {
      throw new ConflictException('Ainda há tarefas abertas neste projeto');
    }
    await this.prisma.productionProject.update({
      where: { id },
      data: {
        status: 'DONE',
        history: {
          create: {
            byUserId: viewer.userId,
            byName: viewer.name,
            text: 'Concluiu o projeto',
          },
        },
      },
    });
    // A baixa por consumo nasce da produção (ES-7): fora do caminho, uma
    // falha não desfaz a conclusão
    await consumeSale(this.prisma, project.quotationId, viewer.name).catch(
      (error) =>
        this.logger.error(
          `Baixa por consumo da venda ${project.quotationId}: ${error.message}`,
        ),
    );
    // A venda rápida no caixa passa a aguardar a retirada (FC-19)
    await this.prisma.pendingSale.updateMany({
      where: {
        quotationId: project.quotationId,
        delivered: false,
        ready: false,
        cancelled: false,
      },
      data: { ready: true, readyAt: new Date() },
    });
    await this.mirror.sync(id);
    return { id, status: 'DONE', autoDone: 0 };
  }

  /** Cancela: fecha os relógios e cancela as tarefas abertas. */
  async cancel(viewer: ProductionViewer, id: string) {
    const project = await this.projectOf(viewer.companyId, id);
    if (project.status === 'DONE' || project.status === 'CANCELED') {
      throw new ConflictException(PROJECT_CLOSED);
    }
    await this.prisma.$transaction((tx) =>
      cancelProjectInTx(
        tx,
        id,
        { userId: viewer.userId, name: viewer.name },
        { project: 'Cancelou o projeto', task: 'Cancelada com o projeto' },
      ),
    );
    await this.mirror.sync(id);
    return { id, status: 'CANCELED', autoDone: 0 };
  }

  /** A nova entrega; o primeiro prazo fica (GP-8). */
  async changeDelivery(viewer: ProductionViewer, id: string, due?: string) {
    const project = await this.projectOf(viewer.companyId, id);
    if (
      !due ||
      !/^\d{4}-\d{2}-\d{2}$/.test(due) ||
      Number.isNaN(dateColumn(due).getTime())
    ) {
      throw new BadRequestException('Informe a nova data');
    }
    const before = dayKey(project.due);
    // A Agenda de entrega vai junto (decisão de 15/10/2026)
    const moved = await this.prisma.$transaction(async (tx) => {
      await tx.productionProject.update({
        where: { id },
        data: {
          due: dateColumn(due),
          history: {
            create: {
              byUserId: viewer.userId,
              byName: viewer.name,
              text: `Alterou a entrega de ${brDate(before)} para ${brDate(due)}`,
              data: { from: before, to: due },
            },
          },
        },
      });
      return moveScheduleInTx(tx, project.quotationId, due);
    });
    const ctx = await this.view.context(viewer, { id });
    const summary = ctx.chain.projectSummary(
      id,
      ctx.rows.map((row) => ctx.chain.task(row.id)!),
    );
    return {
      id,
      firstDue: dayKey(project.firstDue),
      due,
      risk: summary.risk,
      // A Agenda de entrega também mudou
      scheduleMoved: moved,
    };
  }
}
