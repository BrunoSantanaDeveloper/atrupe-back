import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  parseProjectDayBoundary,
  toProjectDateKey,
} from '../fiscal/utils/project-date.util';
import { isOpen } from './engine/production-chain';
import { maintenanceBlocks } from './engine/maintenance';
import {
  machineConflicts,
  occupiedBlocks,
  scheduleBlocks,
} from './engine/task-blocks';
import {
  ProductionAccessService,
  ProductionViewer,
} from './production-access.service';
import { MANAGER_NOT_FOUND, taskTypeView } from './production-config.service';
import { dateColumn } from './production-project.service';
import {
  ChainRow,
  ProductionContext,
  ProductionViewService,
} from './production-view.service';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const DAY_MS = 86400000;

const daysBetween = (from: string, to: string) =>
  Math.round((dateColumn(to).getTime() - dateColumn(from).getTime()) / DAY_MS);

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/** O período pedido: os dois dias, com o teto de dias da rota. */
const periodOf = (
  query: { from?: string; to?: string },
  maxDays: number,
  fallback: () => { from: string; to: string },
) => {
  const period =
    query.from && query.to
      ? { from: query.from, to: query.to }
      : query.from || query.to
        ? bad('Informe o início e o fim do período')
        : fallback();
  if (period.from > period.to) bad('A data inicial vem antes da final');
  if (daysBetween(period.from, period.to) + 1 > maxDays) {
    bad(`O período vai até ${maxDays} dias`);
  }
  return period;
};

/**
 * As manutenções que bloqueiam a agenda (GP-49 item 6) entre from e to: o
 * custo fixo do patrimônio com a última ocorrência e o bloqueio ligado. O
 * bloqueio leva o bem e as configurações dele, para casar com a máquina da
 * tarefa (blocksTask). A fila e a agenda viva leem daqui.
 */
export async function machineMaintenance(
  prisma: PrismaService,
  companyId: string,
  from: string,
  to: string,
) {
  const costs = await prisma.assetCost.findMany({
    where: {
      blocksSchedule: true,
      lastOccurrence: { not: null },
      blockStart: { not: null },
      blockMinutes: { not: null },
      asset: { companyId, inactivatedAt: null, soldAt: null },
    },
    select: {
      id: true,
      name: true,
      yieldAmount: true,
      lastOccurrence: true,
      blockStart: true,
      blockMinutes: true,
      asset: {
        select: { id: true, name: true, setups: { select: { id: true } } },
      },
    },
  });
  return maintenanceBlocks(
    costs.map((cost) => ({
      id: cost.id,
      name: cost.name,
      assetId: cost.asset.id,
      machine: cost.asset.name,
      setupIds: cost.asset.setups.map((setup) => setup.id),
      lastOccurrence: cost.lastOccurrence!.toISOString().slice(0, 10),
      everyMonths: cost.yieldAmount,
      start: cost.blockStart!,
      minutes: cost.blockMinutes!,
    })),
    from,
    to,
  );
}

/**
 * O que se lê da produção em conjunto (GP-11, §4.8, GP-30): as abas dos
 * gerenciadores com as contagens, o quadro de um gerenciador, a agenda viva
 * com a frota e a produtividade pelo tempo vendido.
 */
@Injectable()
export class ProductionBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService,
    private readonly view: ProductionViewService,
  ) {}

  private managerOf(ctx: ProductionContext, row: ChainRow) {
    return this.view.stepOf(ctx, row).managerId;
  }

  /** Os gerenciadores ativos que o usuário vê, com abertas e alertas. */
  async managers(viewer: ProductionViewer) {
    const ctx = await this.view.context(viewer, { status: 'PRODUCTION' });
    const open = ctx.rows.filter(
      (row) => isOpen(row.status) && this.view.visible(ctx, row),
    );
    return [...ctx.managers.values()]
      .filter((manager) => manager.isActive)
      .filter(
        (manager) =>
          viewer.manager || viewer.allSectors || viewer.access.has(manager.id),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map((manager) => {
        const own = open.filter(
          (row) => this.managerOf(ctx, row) === manager.id,
        );
        return {
          ...this.view.managerSummaryView(manager),
          open: own.length,
          alerts: own.filter((row) => ctx.chain.alert(ctx.chain.task(row.id)!))
            .length,
        };
      });
  }

  /** As manutenções dos próximos 30 dias que bloqueiam a agenda. */
  private async maintenance(companyId: string) {
    const today = toProjectDateKey(new Date());
    const until = toProjectDateKey(new Date(Date.now() + 30 * DAY_MS));
    return machineMaintenance(this.prisma, companyId, today, until);
  }

  /** O quadro: as tarefas cuja etapa atual está no gerenciador. */
  async board(viewer: ProductionViewer, managerId: string) {
    const manager = await this.prisma.productionManager.findFirst({
      where: { id: managerId, companyId: viewer.companyId },
      select: { id: true },
    });
    if (!manager) throw new NotFoundException(MANAGER_NOT_FOUND);
    this.access.assertManagerAccess(viewer, managerId);
    const ctx = await this.view.context(viewer, { status: 'PRODUCTION' });
    const row = ctx.managers.get(managerId)!;
    const own = ctx.rows.filter(
      (task) => this.managerOf(ctx, task) === managerId,
    );
    const visible = own.filter((task) => this.view.visible(ctx, task));
    const collaborators = row.users
      .map((user) => {
        const person = ctx.collaborators.get(user.employeeId);
        return person ? { ...person, onlyAssigned: user.onlyAssigned } : null;
      })
      .filter(Boolean);
    return {
      manager: {
        ...this.view.managerSummaryView(row),
        flowId: row.flowId,
        // O expediente da empresa: o padrão do gerenciador sem expediente e
        // os dias que não são de trabalho (feriado fica em vermelho, GP-49)
        calendar: ctx.calendar,
        users: row.users.map((user) => ({
          collaboratorId: user.employeeId,
          onlyAssigned: user.onlyAssigned,
        })),
      },
      viewer: {
        collaboratorId: viewer.employeeId,
        name: viewer.name,
        manager: viewer.manager,
      },
      tasks: await this.view.views(
        ctx,
        visible.map((task) => task.id),
      ),
      hidden: own.length - visible.length,
      // As manutenções que bloqueiam a agenda das máquinas (GP-49 item 6)
      maintenance: await this.maintenance(viewer.companyId),
      collaborators,
      taskTypes: [...ctx.types.values()]
        .filter((type) =>
          type.steps.some((step) => step.managerId === managerId),
        )
        .map(taskTypeView),
      vehicles: await this.vehicles(viewer.companyId),
    };
  }

  private async vehicles(companyId: string) {
    const rows = await this.prisma.productionVehicle.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, plate: true },
    });
    return rows;
  }

  /**
   * A agenda viva (§4.8): as tarefas agendadas no período, as abertas sem
   * agenda e a ocupação dos veículos (VS-7). O preparo ocupa a máquina; o
   * intervalo do gerenciador entra na sobreposição da mesma máquina (GP-20).
   * A tarefa entra pelo dia de qualquer bloco de agenda (GP-52), e cada
   * bloco ocupa a máquina no dia dele, com os minutos dele.
   */
  async agenda(
    viewer: ProductionViewer,
    query: { from?: string; to?: string },
  ) {
    const today = toProjectDateKey(new Date());
    const { from, to } = periodOf(query, 92, () => ({
      from: today,
      to: today,
    }));
    const ctx = await this.view.context(viewer, { status: 'PRODUCTION' });
    const visible = ctx.rows.filter((row) => this.view.visible(ctx, row));
    const inPeriod = (date: string) => date >= from && date <= to;
    // O trabalho dividido em dois dias aparece nos dois (GP-52)
    const scheduled = visible
      .map((row) => ({
        row,
        days: scheduleBlocks(row).filter((block) => inPeriod(block.date)),
      }))
      .filter(({ days }) => days.length)
      .sort((a, b) =>
        // Só o dia vai depois das que têm hora
        `${a.days[0].date}${a.days[0].start ?? '99:99'}`.localeCompare(
          `${b.days[0].date}${b.days[0].start ?? '99:99'}`,
        ),
      );
    const unscheduled = visible.filter(
      (row) => isOpen(row.status) && !row.scheduleDate,
    );
    const views = new Map(
      (
        await this.view.views(ctx, [
          ...scheduled.map(({ row }) => row.id),
          ...unscheduled.map((row) => row.id),
        ])
      ).map((view) => [view.id, view]),
    );
    const details = await this.prisma.productionTask.findMany({
      where: { id: { in: scheduled.map(({ row }) => row.id) } },
      select: {
        id: true,
        setupMinutes: true,
        estimatedMinutes: true,
        machine: true,
        vehicleId: true,
        km: true,
      },
    });
    const detailOf = new Map(details.map((detail) => [detail.id, detail]));
    // O intervalo programado do gerenciador entre tarefas na mesma máquina
    const intervalOf = (row: ChainRow) => {
      const managerId = this.managerOf(ctx, row);
      return (managerId && ctx.managers.get(managerId)?.intervalMinutes) || 0;
    };
    // A máquina ocupada bloco a bloco, no dia de cada um (GP-52): a tarefa
    // dividida ocupa em cada dia só o que é dele. Só o dia (GP-49): sem a
    // hora, não há horário para sobrepor
    const conflicts = machineConflicts(
      scheduled.flatMap(({ row }) => {
        const detail = detailOf.get(row.id)!;
        return occupiedBlocks({ ...row, setupMinutes: detail.setupMinutes })
          .filter((block) => inPeriod(block.date))
          .map((block) => {
            const start = block.start ? minutesOf(block.start) : null;
            return {
              taskId: row.id,
              machine: detail.machine,
              date: block.date,
              start,
              end: start === null ? null : start + block.minutes,
              interval: intervalOf(row),
            };
          });
      }),
    );

    // Os veículos por dia: os km somados e saídas que se sobrepõem. A tarefa
    // dividida usa o veículo em cada dia; os km dela contam no bloco 1
    const usage = new Map<
      string,
      {
        vehicleId: string;
        date: string;
        km: number;
        tasks: string[];
        spans: { taskId: string; start: number; end: number }[];
      }
    >();
    for (const { row, days } of scheduled) {
      const detail = detailOf.get(row.id)!;
      if (!detail.vehicleId) continue;
      for (const block of days) {
        const key = `${detail.vehicleId}:${block.date}`;
        const entry = usage.get(key) ?? {
          vehicleId: detail.vehicleId,
          date: block.date,
          km: 0,
          tasks: [],
          spans: [],
        };
        if (block.slotId === null) entry.km += detail.km ?? 0;
        if (!entry.tasks.includes(row.id)) entry.tasks.push(row.id);
        if (block.start) {
          const start = minutesOf(block.start);
          entry.spans.push({
            taskId: row.id,
            start,
            end: start + block.minutes,
          });
        }
        usage.set(key, entry);
      }
    }
    const overlaps = (
      spans: { taskId: string; start: number; end: number }[],
    ) =>
      spans.some((span) =>
        spans.some(
          (other) =>
            other.taskId !== span.taskId &&
            other.start < span.end &&
            span.start < other.end,
        ),
      );

    return {
      scheduled: scheduled.map(({ row }) => {
        const detail = detailOf.get(row.id)!;
        return {
          ...views.get(row.id)!,
          occupies:
            detail.setupMinutes +
            Math.max(detail.estimatedMinutes - detail.setupMinutes, 0),
          // A mesma máquina ocupada ao mesmo tempo em algum bloco, contando
          // o intervalo
          conflict: conflicts.has(row.id),
        };
      }),
      unscheduled: unscheduled.map((row) => views.get(row.id)!),
      vehicles: await this.vehicles(viewer.companyId),
      vehicleUsage: [...usage.values()].map(({ spans, ...entry }) => ({
        ...entry,
        km: round1(entry.km),
        conflict: overlaps(spans),
      })),
      managers: [...ctx.managers.values()]
        .filter((manager) => manager.isActive)
        .filter(
          (manager) =>
            viewer.manager ||
            viewer.allSectors ||
            viewer.access.has(manager.id),
        )
        .map((manager) => this.view.managerSummaryView(manager)),
      from,
      to,
    };
  }

  /**
   * A produtividade pelo tempo vendido (GP-30, GP-32, GP-34), pela data de
   * conclusão. Por pessoa, só para quem tem a permissão: sem ela, `people`
   * nem sai (PCP-3).
   */
  async productivity(
    viewer: ProductionViewer,
    query: { from?: string; to?: string },
  ) {
    const today = toProjectDateKey(new Date());
    const { from, to } = periodOf(query, 366, () => ({
      from: `${today.slice(0, 8)}01`,
      to: today,
    }));
    const start = parseProjectDayBoundary(from, 'start')!;
    const end = parseProjectDayBoundary(to, 'end')!;
    const companyId = viewer.companyId;
    const [done, canceled, sectors, people] = await Promise.all([
      this.prisma.productionTask.findMany({
        where: {
          companyId,
          status: 'DONE',
          completedAt: { gte: start, lte: end },
        },
        select: {
          sectorId: true,
          sectorName: true,
          estimatedMinutes: true,
          timeEntries: {
            select: { employeeId: true, seconds: true, end: true },
          },
        },
      }),
      this.prisma.productionTimeEntry.findMany({
        where: {
          companyId,
          end: { gte: start, lte: end },
          task: { status: 'CANCELED' },
        },
        select: { seconds: true, task: { select: { sectorId: true } } },
      }),
      this.prisma.companySector.findMany({
        where: { companyId },
        select: { id: true, name: true, color: true },
      }),
      this.prisma.employee.findMany({
        where: { companyId },
        select: { id: true, name: true, user: { select: { name: true } } },
      }),
    ]);
    const sectorOf = new Map(sectors.map((sector) => [sector.id, sector]));
    const closedMinutes = (task: (typeof done)[number]) =>
      task.timeEntries
        .filter((entry) => entry.end)
        .reduce((sum, entry) => sum + entry.seconds / 60, 0);

    const bySectorMap = new Map<
      string,
      {
        sector: { id: string | null; name: string; color: string | null };
        tasks: number;
        sold: number;
        worked: number;
      }
    >();
    for (const task of done) {
      const key = task.sectorId ?? `nome:${task.sectorName}`;
      const known = task.sectorId ? sectorOf.get(task.sectorId) : null;
      const entry = bySectorMap.get(key) ?? {
        sector: {
          id: task.sectorId,
          name: known?.name ?? task.sectorName,
          color: known?.color ?? null,
        },
        tasks: 0,
        sold: 0,
        worked: 0,
      };
      entry.tasks += 1;
      entry.sold += task.estimatedMinutes;
      entry.worked += closedMinutes(task);
      bySectorMap.set(key, entry);
    }
    const productivityOf = (sold: number, worked: number) =>
      worked > 0 ? round1((sold / worked) * 100) : null;

    const unsoldBySector = new Map<string, number>();
    for (const entry of canceled) {
      const key = entry.task.sectorId ?? '';
      unsoldBySector.set(
        key,
        (unsoldBySector.get(key) ?? 0) + entry.seconds / 60,
      );
    }

    const result: {
      bySector: unknown[];
      people?: unknown[];
      unsold: {
        minutes: number;
        bySector: { sectorId: string | null; minutes: number }[];
      };
      from: string;
      to: string;
    } = {
      bySector: [...bySectorMap.values()]
        .sort((a, b) => a.sector.name.localeCompare(b.sector.name, 'pt-BR'))
        .map((entry) => ({
          sector: entry.sector,
          tasks: entry.tasks,
          sold: entry.sold,
          worked: round1(entry.worked),
          productivity: productivityOf(entry.sold, entry.worked),
        })),
      unsold: {
        minutes: round1(
          [...unsoldBySector.values()].reduce((sum, value) => sum + value, 0),
        ),
        bySector: [...unsoldBySector.entries()].map(([sectorId, minutes]) => ({
          sectorId: sectorId || null,
          minutes: round1(minutes),
        })),
      },
      from,
      to,
    };

    if (viewer.productivity) {
      // A divisão proporcional (GP-32): 70 % do tempo, 70 % do vendido
      const byPerson = new Map<
        string,
        { tasks: number; sold: number; worked: number }
      >();
      for (const task of done) {
        const total = closedMinutes(task);
        const mine = new Map<string, number>();
        for (const entry of task.timeEntries.filter((item) => item.end)) {
          mine.set(
            entry.employeeId,
            (mine.get(entry.employeeId) ?? 0) + entry.seconds / 60,
          );
        }
        for (const [employeeId, minutes] of mine) {
          if (!minutes) continue;
          const person = byPerson.get(employeeId) ?? {
            tasks: 0,
            sold: 0,
            worked: 0,
          };
          person.tasks += 1;
          person.worked += minutes;
          person.sold += total ? (task.estimatedMinutes * minutes) / total : 0;
          byPerson.set(employeeId, person);
        }
      }
      const names = new Map(
        people.map((person) => [
          person.id,
          person.name || person.user?.name || '',
        ]),
      );
      result.people = [...byPerson.entries()]
        .map(([collaboratorId, person]) => ({
          collaboratorId,
          name: names.get(collaboratorId) ?? '',
          tasks: person.tasks,
          sold: round1(person.sold),
          worked: round1(person.worked),
          productivity: productivityOf(person.sold, person.worked),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    }
    return result;
  }
}
