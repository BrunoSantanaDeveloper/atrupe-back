import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/config/prisma/prisma.service';

import {
  toProjectDateKey,
  toProjectTimeKey,
} from '../fiscal/utils/project-date.util';
import {
  momentOf,
  replan,
  ReplanMove,
  ReplanTask,
} from './engine/chain-replan';
import { liveHoursOf, nextWorkDay, toMinutes } from './engine/live-schedule';
import { carrySlots } from './engine/slot-carry';
import { DEFAULT_CALENDAR } from './engine/production-chain';
import { ProductionMirrorService } from './production-mirror.service';
import { dateColumn } from './production-project.service';

const brDate = (day: string) => day.split('-').reverse().join('/');
const when = (value: { date: string; start: string | null }) =>
  value.start ? `${brDate(value.date)} às ${value.start}` : brDate(value.date);

/** Abaixo disso a mudança é gravada sem entrar no histórico */
const QUIET_MINUTES = 15;

/**
 * A agenda viva da cadeia (Maicol, 24/11/2026): com "avisar e reagendar" no
 * expediente da empresa, refaz a agenda de todas as máquinas pela cadeia
 * (engine/chain-replan.ts) e grava o horário novo, com o motivo no
 * histórico da tarefa. Roda depois de cada ação na produção e a cada 10
 * minutos, porque o atraso também acontece só com o tempo passando.
 */
@Injectable()
export class ProductionLiveService {
  private readonly logger = new Logger(ProductionLiveService.name);
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mirror: ProductionMirrorService,
  ) {}

  /** Depois de uma ação: nunca vira erro para quem agiu */
  async after(companyId: string) {
    await this.replanCompany(companyId).catch((error) =>
      this.logger.error(
        `Agenda viva da empresa ${companyId}: ${error.message}`,
      ),
    );
  }

  @Cron('*/10 * * * *', { name: 'production-live-schedule' })
  async tick() {
    const companies = await this.prisma.productionCalendar.findMany({
      where: { liveSchedule: 'RESCHEDULE' },
      select: { companyId: true },
    });
    for (const { companyId } of companies) await this.after(companyId);
  }

  /**
   * Na virada do dia: o que não foi feito num bloco de agenda passa para o
   * seguinte (24/11/2026; engine/slot-carry.ts). Vale com ou sem a agenda
   * viva.
   */
  @Cron('10 0 * * *', { name: 'production-slot-carry' })
  async carryAll() {
    const now = new Date();
    const today = toProjectDateKey(now);
    const tasks = await this.prisma.productionTask.findMany({
      where: {
        status: { notIn: ['DONE', 'CANCELED'] },
        slots: { some: {} },
        OR: [
          { scheduleDate: { lt: dateColumn(today) } },
          { slots: { some: { date: { lt: dateColumn(today) } } } },
        ],
      },
      select: { id: true, companyId: true },
    });
    for (const task of tasks) {
      await this.carryTask(task.companyId, task.id, now).catch((error) =>
        this.logger.error(`Blocos da tarefa ${task.id}: ${error.message}`),
      );
    }
  }

  async carryTask(companyId: string, id: string, now = new Date()) {
    const today = toProjectDateKey(now);
    const task = await this.prisma.productionTask.findFirst({
      where: { id, companyId },
      select: {
        projectId: true,
        scheduleDate: true,
        scheduleStart: true,
        scheduleMinutes: true,
        estimatedMinutes: true,
        slots: { select: { id: true, date: true, start: true, minutes: true } },
        timeEntries: { select: { slotId: true, seconds: true } },
      },
    });
    if (!task?.scheduleDate) return;
    const calendar =
      (await this.prisma.productionCalendar.findUnique({
        where: { companyId },
        select: { workDays: true, holidays: true },
      })) ?? DEFAULT_CALENDAR;
    const workedOf = (slotId: string | null) =>
      task.timeEntries
        .filter((entry) => entry.slotId === slotId)
        .reduce((sum, entry) => sum + entry.seconds, 0) / 60;
    const day = (value: Date) => value.toISOString().slice(0, 10);
    const isWork = (date: string) =>
      calendar.workDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) &&
      !calendar.holidays.includes(date);
    const firstWorkDay = isWork(today) ? today : nextWorkDay(today, calendar);
    const ops = carrySlots({
      today,
      firstWorkDay,
      blocks: [
        {
          id: 'main',
          date: day(task.scheduleDate),
          start: task.scheduleStart,
          minutes: task.scheduleMinutes || task.estimatedMinutes,
          worked: workedOf(null),
        },
        ...task.slots.map((slot) => ({
          id: slot.id,
          date: day(slot.date),
          start: slot.start,
          minutes: slot.minutes,
          worked: workedOf(slot.id),
        })),
      ],
    });
    if (!ops.length) return;
    await this.prisma.$transaction(async (tx) => {
      for (const op of ops) {
        if (op.kind === 'create') {
          await tx.productionTaskSlot.create({
            data: {
              companyId,
              taskId: id,
              date: dateColumn(op.date),
              minutes: op.minutes,
              kind: 'NORMAL',
              byName: 'Agenda',
            },
          });
        } else if (op.kind === 'delete') {
          await tx.productionTaskSlot.delete({ where: { id: op.id } });
        } else if (op.id === 'main') {
          await tx.productionTask.update({
            where: { id },
            data:
              op.kind === 'move'
                ? {
                    scheduleDate: dateColumn(op.date),
                    scheduleStart: op.start,
                    scheduleMinutes: op.minutes,
                  }
                : { scheduleMinutes: op.minutes },
          });
        } else {
          await tx.productionTaskSlot.update({
            where: { id: op.id },
            data:
              op.kind === 'move'
                ? {
                    date: dateColumn(op.date),
                    start: op.start,
                    minutes: op.minutes,
                  }
                : { minutes: op.minutes },
          });
        }
      }
      await tx.productionTaskHistory.create({
        data: {
          taskId: id,
          byName: 'Agenda',
          text: 'O que não foi feito no bloco do dia passou para o bloco seguinte',
        },
      });
    });
    await this.mirror.sync(task.projectId);
  }

  async replanCompany(companyId: string, now = new Date()) {
    if (this.running.has(companyId)) return [];
    this.running.add(companyId);
    try {
      return await this.run(companyId, now);
    } finally {
      this.running.delete(companyId);
    }
  }

  private async run(companyId: string, now: Date): Promise<ReplanMove[]> {
    const calendarRow = await this.prisma.productionCalendar.findUnique({
      where: { companyId },
    });
    if (calendarRow?.liveSchedule !== 'RESCHEDULE') return [];
    const calendar = calendarRow ?? DEFAULT_CALENDAR;

    const rows = await this.prisma.productionTask.findMany({
      where: {
        companyId,
        project: { status: { in: ['STANDBY', 'PRODUCTION'] } },
      },
      select: {
        id: true,
        projectId: true,
        stageName: true,
        status: true,
        dependsOn: true,
        releasedNext: true,
        machine: true,
        estimatedMinutes: true,
        scheduleDate: true,
        scheduleStart: true,
        scheduleMinutes: true,
        scheduleLocked: true,
        assigneeId: true,
        completedAt: true,
        currentStep: { select: { managerId: true } },
        _count: { select: { slots: true } },
        timeEntries: { select: { start: true, end: true, seconds: true } },
      },
    });
    if (!rows.length) return [];
    const managerIds = [
      ...new Set(rows.map((row) => row.currentStep?.managerId).filter(Boolean)),
    ] as string[];
    const managers = new Map(
      (
        await this.prisma.productionManager.findMany({
          where: { id: { in: managerIds } },
          select: {
            id: true,
            intervalMinutes: true,
            workStart: true,
            workEnd: true,
            breakStart: true,
            breakEnd: true,
            runsThroughBreak: true,
            afterDoneMinutes: true,
          },
        })
      ).map((manager) => [manager.id, manager]),
    );
    const plainHours = {
      workStart: null,
      workEnd: null,
      breakStart: null,
      breakEnd: null,
      runsThroughBreak: false,
    };
    const local = (instant: Date) =>
      momentOf(toProjectDateKey(instant), toProjectTimeKey(instant));
    const day = (value: Date | null) =>
      value ? value.toISOString().slice(0, 10) : null;

    const tasks: ReplanTask[] = rows.map((row) => {
      const manager = row.currentStep?.managerId
        ? managers.get(row.currentStep.managerId)
        : undefined;
      const hours = liveHoursOf(manager ?? plainHours, calendar);
      const actual =
        row.timeEntries.reduce(
          (sum, entry) =>
            sum +
            (entry.end
              ? entry.seconds
              : Math.max(0, (now.getTime() - entry.start.getTime()) / 1000)),
          0,
        ) / 60;
      const minutes = row.scheduleMinutes || row.estimatedMinutes || 0;
      const scheduleDate = day(row.scheduleDate);
      return {
        id: row.id,
        label: row.stageName,
        status: row.status,
        dependsOn: row.dependsOn,
        released: !!row.releasedNext,
        // A fila: a máquina; sem ela, a pessoa atribuída; sem ninguém, a
        // equipe do gerenciador (uma por vez)
        resource: manager
          ? row.machine
            ? `${manager.id}|${row.machine}`
            : row.assigneeId
              ? `${manager.id}|p:${row.assigneeId}`
              : `${manager.id}|`
          : null,
        hours,
        intervalMinutes: manager?.intervalMinutes ?? 0,
        afterDoneMinutes: manager?.afterDoneMinutes ?? 0,
        minutes,
        remainingMinutes: Math.max(
          0,
          (row.estimatedMinutes || minutes) - actual,
        ),
        schedule: scheduleDate
          ? { date: scheduleDate, start: row.scheduleStart }
          : null,
        locked: row.scheduleLocked,
        completedAt: row.completedAt ? local(row.completedAt) : null,
        fixed: row._count.slots > 0,
      };
    });

    const moves = replan({ tasks, calendar, now: local(now) });
    if (!moves.length) return moves;

    const delta = (move: ReplanMove) => {
      if (move.from.date !== move.to.date) return Infinity;
      if (!move.from.start || !move.to.start) return 0;
      return Math.abs(toMinutes(move.to.start) - toMinutes(move.from.start));
    };
    const text = (move: ReplanMove) => {
      const why =
        move.reason === 'LATE_PREDECESSOR'
          ? `a etapa anterior (${move.by}) atrasou`
          : move.reason === 'EARLIER'
            ? 'a cadeia andou e deu para adiantar'
            : 'a fila da máquina andou';
      return `Reagendada de ${when(move.from)} para ${when(move.to)}: ${why} (agenda viva)`;
    };
    await this.prisma.$transaction(async (tx) => {
      for (const move of moves) {
        await tx.productionTask.update({
          where: { id: move.id },
          data: {
            scheduleDate: dateColumn(move.to.date),
            scheduleStart: move.to.start,
          },
        });
        if (delta(move) >= QUIET_MINUTES) {
          await tx.productionTaskHistory.create({
            data: { taskId: move.id, byName: 'Agenda viva', text: text(move) },
          });
        }
      }
    });
    const projects = new Set(
      rows
        .filter((row) => moves.some((move) => move.id === row.id))
        .map((row) => row.projectId),
    );
    for (const projectId of projects) await this.mirror.sync(projectId);
    return moves;
  }
}
