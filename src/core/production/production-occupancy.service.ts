import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from 'src/config/prisma/prisma.service';
import { BlockTask, occupiedBlocks } from './engine/task-blocks';
import { ProductionConfigService } from './production-config.service';

/**
 * O mapa de ocupação (GP-50; Maicol, 23/11/2026): por setor e por dia, para
 * saber para quando dá para agendar ou prometer um serviço. Só o ELITE (vem
 * do tempo agendado). Quem vê a Agenda de entrega também vê, inclusive o
 * vendedor: por isso a rota devolve só os totais, sem as tarefas.
 *
 * O ocupado do dia é o tempo das tarefas abertas agendadas para ele, no
 * gerenciador da etapa em que cada uma está, bloco a bloco (GP-52): sem
 * outros blocos, o maior entre o previsto, o preparo e a duração agendada;
 * com eles, cada bloco conta o que é dele, no dia dele, e a soma dá o total
 * (dividir 480 min em 240 + 240 ocupa 240 em cada dia).
 */
export type OccupancyTask = BlockTask & {
  currentStepId: string | null;
  taskTypeId: string;
};

export type OccupancyStep = {
  id: string;
  taskTypeId: string;
  managerId: string;
};

/** Os minutos ocupados por gerenciador e por dia; com o período, só nele. */
export function occupancyOf(
  tasks: OccupancyTask[],
  steps: OccupancyStep[],
  period?: { from: string; to: string },
) {
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
    const step =
      (task.currentStepId && stepById.get(task.currentStepId)) ||
      firstStep.get(task.taskTypeId);
    if (!step) continue;
    for (const block of occupiedBlocks(task)) {
      if (period && (block.date < period.from || block.date > period.to)) {
        continue;
      }
      const key = `${step.managerId}:${block.date}`;
      const entry = totals.get(key) ?? {
        managerId: step.managerId,
        date: block.date,
        minutes: 0,
        tasks: 0,
      };
      entry.minutes += block.minutes;
      entry.tasks += 1;
      totals.set(key, entry);
    }
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
    const range = {
      gte: new Date(`${from}T00:00:00Z`),
      lte: new Date(`${to}T00:00:00Z`),
    };
    const [managers, steps, tasks, calendar] = await Promise.all([
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
      // As tarefas abertas com algum bloco de agenda no período (GP-52): o
      // bloco 1 ou outro (o resto de um trabalho dividido, o tempo extra).
      // Sem o bloco 1, a tarefa está fora da agenda e não ocupa nada
      this.prisma.productionTask.findMany({
        where: {
          companyId,
          status: { notIn: ['DONE', 'CANCELED'] },
          scheduleDate: { not: null },
          OR: [{ scheduleDate: range }, { slots: { some: { date: range } } }],
        },
        select: {
          scheduleDate: true,
          scheduleStart: true,
          scheduleMinutes: true,
          estimatedMinutes: true,
          setupMinutes: true,
          currentStepId: true,
          taskTypeId: true,
          slots: {
            select: {
              id: true,
              date: true,
              start: true,
              minutes: true,
              kind: true,
            },
          },
        },
      }),
      this.config.calendar(companyId),
    ]);
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
      days: occupancyOf(tasks, steps, { from, to }),
    };
  }
}
