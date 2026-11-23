import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from 'src/config/prisma/prisma.service';
import { ProductionConfigService } from './production-config.service';

/**
 * O mapa de ocupação (GP-50; Maicol, 23/11/2026): por setor e por dia, para
 * saber para quando dá para agendar ou prometer um serviço. Só o ELITE (vem
 * do tempo agendado). Quem vê a Agenda de entrega também vê, inclusive o
 * vendedor: por isso a rota devolve só os totais, sem as tarefas.
 *
 * O ocupado do dia é o tempo das tarefas abertas agendadas para ele, no
 * gerenciador da etapa em que cada uma está, pela mesma conta da agenda viva:
 * o maior entre o previsto, o preparo e a duração agendada.
 */
export type OccupancyTask = {
  scheduleDate: Date | null;
  scheduleMinutes: number | null;
  estimatedMinutes: number;
  setupMinutes: number;
  currentStepId: string | null;
  taskTypeId: string;
};

export type OccupancyStep = {
  id: string;
  taskTypeId: string;
  managerId: string;
};

const day = (value: Date) => value.toISOString().slice(0, 10);

/** Os minutos ocupados por gerenciador e por dia. */
export function occupancyOf(tasks: OccupancyTask[], steps: OccupancyStep[]) {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  // Sem etapa atual, a tarefa está na primeira etapa do tipo dela
  const firstStep = new Map<string, OccupancyStep>();
  for (const step of steps) {
    if (!firstStep.has(step.taskTypeId)) firstStep.set(step.taskTypeId, step);
  }
  const totals = new Map<
    string,
    { managerId: string; date: string; minutes: number; tasks: number }
  >();
  for (const task of tasks) {
    if (!task.scheduleDate) continue;
    const step =
      (task.currentStepId && stepById.get(task.currentStepId)) ||
      firstStep.get(task.taskTypeId);
    if (!step) continue;
    const date = day(task.scheduleDate);
    const minutes = Math.max(
      task.estimatedMinutes,
      task.setupMinutes,
      task.scheduleMinutes ?? 0,
    );
    const key = `${step.managerId}:${date}`;
    const entry = totals.get(key) ?? {
      managerId: step.managerId,
      date,
      minutes: 0,
      tasks: 0,
    };
    entry.minutes += minutes;
    entry.tasks += 1;
    totals.set(key, entry);
  }
  return [...totals.values()].sort((a, b) =>
    `${a.date}${a.managerId}`.localeCompare(`${b.date}${b.managerId}`),
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;

@Injectable()
export class ProductionOccupancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ProductionConfigService,
  ) {}

  async occupancy(companyId: string, from: string, to: string) {
    if (!DATE.test(from ?? '') || !DATE.test(to ?? '') || from > to) {
      throw new BadRequestException(
        'Informe o período em AAAA-MM-DD (from e to).',
      );
    }
    const span =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000;
    if (span > MAX_DAYS) {
      throw new BadRequestException(`O período vai até ${MAX_DAYS} dias.`);
    }
    const [managers, steps, tasks, calendar, slots] = await Promise.all([
      this.prisma.productionManager.findMany({
        where: { companyId, isActive: true },
        select: {
          id: true,
          name: true,
          workStart: true,
          workEnd: true,
          breakStart: true,
          breakEnd: true,
          runsThroughBreak: true,
          sector: { select: { id: true, name: true, icon: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.productionTaskStep.findMany({
        where: { taskType: { companyId } },
        select: { id: true, taskTypeId: true, managerId: true },
        orderBy: { position: 'asc' },
      }),
      this.prisma.productionTask.findMany({
        where: {
          companyId,
          status: { notIn: ['DONE', 'CANCELED'] },
          scheduleDate: {
            gte: new Date(`${from}T00:00:00Z`),
            lte: new Date(`${to}T00:00:00Z`),
          },
        },
        select: {
          scheduleDate: true,
          scheduleMinutes: true,
          estimatedMinutes: true,
          setupMinutes: true,
          currentStepId: true,
          taskTypeId: true,
        },
      }),
      this.config.calendar(companyId),
      // Os outros blocos de agenda (GP-52): o resto de um trabalho dividido
      // e o tempo extra ocupam o dia deles
      this.prisma.productionTaskSlot.findMany({
        where: {
          companyId,
          date: {
            gte: new Date(`${from}T00:00:00Z`),
            lte: new Date(`${to}T00:00:00Z`),
          },
          task: { status: { notIn: ['DONE', 'CANCELED'] } },
        },
        select: {
          date: true,
          minutes: true,
          task: { select: { currentStepId: true, taskTypeId: true } },
        },
      }),
    ]);
    const slotTasks: OccupancyTask[] = slots.map((slot) => ({
      scheduleDate: slot.date,
      scheduleMinutes: slot.minutes,
      estimatedMinutes: 0,
      setupMinutes: 0,
      currentStepId: slot.task.currentStepId,
      taskTypeId: slot.task.taskTypeId,
    }));
    return {
      from,
      to,
      calendar,
      managers: managers.map((manager) => ({
        id: manager.id,
        name: manager.name,
        sector: manager.sector,
        hours: {
          workStart: manager.workStart,
          workEnd: manager.workEnd,
          breakStart: manager.breakStart,
          breakEnd: manager.breakEnd,
          runsThroughBreak: manager.runsThroughBreak,
        },
      })),
      days: occupancyOf([...tasks, ...slotTasks], steps),
    };
  }
}
