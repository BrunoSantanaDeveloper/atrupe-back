/**
 * A agenda viva da cadeia (Maicol, 24/11/2026): "quando a criação atrasa,
 * ela atrasa toda a cadeia que vem depois; não é uma agenda diferente, é a
 * mesma agenda que atualiza sozinha". Com "avisar e reagendar" ligado no
 * expediente da empresa, a agenda de todas as máquinas é refeita pela
 * cadeia:
 * - a etapa só começa quando as anteriores terminam (mais o tempo após a
 *   conclusão, ex.: secagem); a que libera antes (FL-13) não segura;
 * - cada máquina faz um trabalho por vez, na ordem da fila, com o intervalo
 *   entre tarefas; quando o próximo da fila ainda espera a etapa anterior,
 *   o seguinte que já pode começar ocupa o lugar ("atrasa essa impressão e
 *   adianta outra para colocar no lugar");
 * - quando a anterior termina antes, as seguintes são puxadas para mais
 *   cedo, se houver espaço na agenda: o que segura é a cadeia (não se
 *   imprime antes de a criação ser aprovada);
 * - o cadeado trava o trabalho na agenda: não adianta nem atrasa; se a
 *   cadeia não chegar a tempo, acende o alerta (production-chain.ts);
 * - a fila é a máquina; sem máquina, a pessoa atribuída; sem ninguém, a
 *   equipe do gerenciador (ex.: a instalação faz uma por vez);
 * - o expediente é o do gerenciador (ou o da empresa), com o intervalo e
 *   os dias de trabalho e feriados da empresa; o trabalho que passa do fim
 *   do dia continua no dia útil seguinte.
 *
 * O que está em andamento, pausado ou com pendência fica onde está e ocupa a
 * máquina pelo que falta; a tarefa dividida em blocos (GP-52) não se move
 * (o que não foi feito num bloco passa para o seguinte: slot-carry.ts).
 * A tarefa sem agenda não entra.
 *
 * Pura: o serviço grava e registra no histórico.
 */

import type { LiveHours } from './live-schedule';
import { hhmm, toMinutes } from './live-schedule';

/** Minutos absolutos: dia (desde 1970) × 1440 + minuto do dia, no fuso da empresa */
export type Moment = number;

export type ReplanStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PAUSED'
  | 'PENDING'
  | 'DONE'
  | 'CANCELED';

export type ReplanTask = {
  id: string;
  /** O nome da etapa, para o histórico ("a Criação atrasou") */
  label: string;
  status: ReplanStatus;
  dependsOn: string[];
  /** Liberou a próxima etapa antes de concluir (FL-13): não segura a cadeia */
  released: boolean;
  /** A fila (o gerenciador e a máquina, a pessoa ou a equipe); nulo, sem gerenciador */
  resource: string | null;
  hours: LiveHours;
  intervalMinutes: number;
  /** A espera depois de concluir antes da etapa seguinte */
  afterDoneMinutes: number;
  /** A duração agendada (ou a estimada) */
  minutes: number;
  /** O que falta, para a que está em andamento */
  remainingMinutes: number;
  schedule: { date: string; start: string | null } | null;
  /** O cadeado: travada na agenda, não anda */
  locked?: boolean;
  completedAt: Moment | null;
  /** Dividida em blocos (GP-52): fica onde está */
  fixed?: boolean;
};

export type ReplanCalendar = { workDays: number[]; holidays: string[] };

export type ReplanMove = {
  id: string;
  from: { date: string; start: string | null };
  to: { date: string; start: string | null };
  /** Por que andou: a etapa anterior atrasou, terminou antes, ou a fila da máquina */
  reason: 'LATE_PREDECESSOR' | 'EARLIER' | 'QUEUE';
  /** A etapa anterior que segurou (para LATE_PREDECESSOR) */
  by: string | null;
};

const DAY = 1440;

export const dayNumber = (date: string) =>
  Math.round(
    Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) /
      86400000,
  );

export const dateOfDay = (day: number) =>
  new Date(day * 86400000).toISOString().slice(0, 10);

export const momentOf = (date: string, time: string) =>
  dayNumber(date) * DAY + toMinutes(time);

const dateOf = (moment: Moment) => dateOfDay(Math.floor(moment / DAY));
const minuteOf = (moment: Moment) => ((moment % DAY) + DAY) % DAY;

const isOpen = (status: ReplanStatus) =>
  status !== 'DONE' && status !== 'CANCELED';

export class WorkClock {
  constructor(private readonly calendar: ReplanCalendar) {}

  isWorkDay(day: number) {
    const date = dateOfDay(day);
    const weekday = new Date(day * 86400000).getUTCDay();
    return (
      this.calendar.workDays.includes(weekday) &&
      !this.calendar.holidays.includes(date)
    );
  }

  /** O próximo dia útil a partir de day (ele mesmo, se for) */
  workDayFrom(day: number) {
    for (let count = 0; count < 400; count++) {
      if (this.isWorkDay(day + count)) return day + count;
    }
    return day;
  }

  /**
   * O primeiro instante em que dá para começar a partir de moment: dentro do
   * expediente, fora do intervalo (ninguém começa nele), em dia útil.
   */
  startAt(moment: Moment, hours: LiveHours): Moment {
    const workStart = toMinutes(hours.workStart);
    const workEnd = toMinutes(hours.workEnd);
    const breakStart = hours.breakStart ? toMinutes(hours.breakStart) : null;
    const breakEnd = hours.breakEnd ? toMinutes(hours.breakEnd) : null;
    let current = moment;
    for (let guard = 0; guard < 400; guard++) {
      const day = Math.floor(current / DAY);
      const workDay = this.workDayFrom(day);
      if (workDay !== day) {
        current = workDay * DAY + workStart;
        continue;
      }
      const minute = minuteOf(current);
      if (minute < workStart) return day * DAY + workStart;
      if (minute >= workEnd) {
        current = (day + 1) * DAY;
        continue;
      }
      if (
        breakStart !== null &&
        breakEnd !== null &&
        minute >= breakStart &&
        minute < breakEnd
      ) {
        return day * DAY + breakEnd;
      }
      return current;
    }
    return current;
  }

  /**
   * O fim de um trabalho de minutes começando em start: a equipe para no
   * intervalo (a máquina que segue nele, não); o que passa do fim do dia
   * continua no dia útil seguinte.
   */
  finish(start: Moment, minutes: number, hours: LiveHours): Moment {
    const workStart = toMinutes(hours.workStart);
    const workEnd = toMinutes(hours.workEnd);
    const breakStart = hours.breakStart ? toMinutes(hours.breakStart) : null;
    const breakEnd = hours.breakEnd ? toMinutes(hours.breakEnd) : null;
    const pause =
      !hours.runsThroughBreak && breakStart !== null && breakEnd !== null;
    let left = Math.max(0, minutes);
    let current = start;
    for (let guard = 0; guard < 800; guard++) {
      const day = Math.floor(current / DAY);
      const minute = minuteOf(current);
      // O trecho de trabalho em que current está
      let segmentEnd = workEnd;
      if (pause && minute < breakStart!) segmentEnd = breakStart!;
      const available = Math.max(0, segmentEnd - minute);
      if (left <= available) return current + left;
      left -= available;
      if (pause && segmentEnd === breakStart) {
        current = day * DAY + breakEnd!;
        continue;
      }
      const next = this.workDayFrom(day + 1);
      current = next * DAY + workStart;
    }
    return current + left;
  }
}

export function replan(input: {
  tasks: ReplanTask[];
  calendar: ReplanCalendar;
  now: Moment;
}): ReplanMove[] {
  const clock = new WorkClock(input.calendar);
  const { now } = input;
  const byId = new Map(input.tasks.map((task) => [task.id, task]));

  const scheduledMoment = (task: ReplanTask) =>
    task.schedule
      ? momentOf(
          task.schedule.date,
          task.schedule.start ?? task.hours.workStart,
        )
      : null;

  // O que fica onde está: em andamento, pausada, com pendência, em blocos,
  // travada
  const pinned = new Map<string, { start: Moment; end: Moment }>();
  const anchored = (task: ReplanTask) => !!task.fixed || !!task.locked;
  const stays = (task: ReplanTask) =>
    task.status === 'IN_PROGRESS' ||
    task.status === 'PAUSED' ||
    task.status === 'PENDING' ||
    anchored(task);
  for (const task of input.tasks) {
    if (!isOpen(task.status) || !stays(task)) continue;
    if (anchored(task) && task.status === 'NOT_STARTED') {
      const start = scheduledMoment(task);
      if (start === null) continue;
      pinned.set(task.id, {
        start,
        end: clock.finish(start, task.minutes, task.hours),
      });
      continue;
    }
    const start = clock.startAt(now, task.hours);
    pinned.set(task.id, {
      start,
      end: clock.finish(start, task.remainingMinutes, task.hours),
    });
  }

  // O que anda: não iniciada, agendada, fora de blocos
  const movable = input.tasks.filter(
    (task) => task.status === 'NOT_STARTED' && task.schedule && !anchored(task),
  );
  // A ordem da fila: o agendado; só o dia vem depois dos com hora
  const order = (task: ReplanTask) =>
    dayNumber(task.schedule!.date) * DAY +
    (task.schedule!.start ? toMinutes(task.schedule!.start) : DAY - 1);
  movable.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));

  let placed = new Map<string, { start: Moment; end: Moment }>();
  // Começa pelo agendado
  for (const task of movable) {
    const start = scheduledMoment(task)!;
    placed.set(task.id, {
      start,
      end: clock.finish(start, task.minutes, task.hours),
    });
  }

  const endOf = (
    id: string,
    current: Map<string, { start: Moment; end: Moment }>,
  ): Moment | null => {
    const task = byId.get(id);
    if (!task) return null;
    if (task.status === 'CANCELED') return null;
    if (task.status === 'DONE') return task.completedAt ?? null;
    return pinned.get(id)?.end ?? current.get(id)?.end ?? null;
  };

  // Quando a etapa pode começar pela cadeia, e qual anterior segura
  const readyOf = (
    task: ReplanTask,
    current: Map<string, { start: Moment; end: Moment }>,
  ) => {
    let ready = -Infinity;
    let by: string | null = null;
    for (const id of task.dependsOn) {
      const dependency = byId.get(id);
      if (!dependency || dependency.released) continue;
      const end = endOf(id, current);
      if (end === null) continue;
      const at = end + Math.max(0, dependency.afterDoneMinutes);
      if (at > ready) {
        ready = at;
        by = dependency.label;
      }
    }
    return { ready, by };
  };

  const earliestOf = (
    task: ReplanTask,
    current: Map<string, { start: Moment; end: Moment }>,
  ) => clock.startAt(Math.max(now, readyOf(task, current).ready), task.hours);

  for (let iteration = 0; iteration < 40; iteration++) {
    const next = new Map<string, { start: Moment; end: Moment }>();
    // Sem máquina: cada uma no seu tempo
    for (const task of movable.filter((item) => !item.resource)) {
      const start = earliestOf(task, placed);
      next.set(task.id, {
        start,
        end: clock.finish(start, task.minutes, task.hours),
      });
    }
    // Na máquina: um por vez, na ordem da fila
    const resources = new Set(
      movable.map((item) => item.resource).filter(Boolean) as string[],
    );
    for (const resource of resources) {
      const queue = movable.filter((item) => item.resource === resource);
      const hours = queue[0].hours;
      const interval = Math.max(0, queue[0].intervalMinutes);
      let cursor = clock.startAt(now, hours);
      for (const task of input.tasks) {
        if (task.resource !== resource) continue;
        const busy = pinned.get(task.id);
        if (busy && busy.start <= cursor) {
          cursor = Math.max(cursor, busy.end + interval);
        }
      }
      const pending = [...queue];
      while (pending.length) {
        const earliest = pending.map((task) => earliestOf(task, placed));
        let index = earliest.findIndex((at) => at <= cursor);
        if (index < 0) {
          cursor = Math.min(...earliest);
          index = earliest.findIndex((at) => at <= cursor);
        }
        const task = pending[index];
        // Um bloco fixo da máquina no caminho: começa depois dele
        let start = clock.startAt(Math.max(cursor, earliest[index]), hours);
        let end = clock.finish(start, task.minutes, hours);
        for (let guard = 0; guard < 20; guard++) {
          const clash = [...pinned.entries()].find(
            ([id, span]) =>
              byId.get(id)?.resource === resource &&
              span.start < end &&
              span.end > start,
          );
          if (!clash) break;
          start = clock.startAt(clash[1].end + interval, hours);
          end = clock.finish(start, task.minutes, hours);
        }
        next.set(task.id, { start, end });
        cursor = end + interval;
        pending.splice(index, 1);
      }
    }
    const stable = movable.every(
      (task) => next.get(task.id)?.start === placed.get(task.id)?.start,
    );
    placed = next;
    if (stable) break;
  }

  const moves: ReplanMove[] = [];
  for (const task of movable) {
    const span = placed.get(task.id);
    if (!span) continue;
    const from = task.schedule!;
    const date = dateOf(span.start);
    const dateOnly = !from.start;
    const to = { date, start: dateOnly ? null : hhmm(minuteOf(span.start)) };
    if (to.date === from.date && to.start === from.start) continue;
    const before = scheduledMoment(task)!;
    const { ready, by } = readyOf(task, placed);
    const late = ready > before && span.start >= ready - 1;
    // Só o dia: anda só quando o dia muda
    if (dateOnly && to.date === from.date) continue;
    moves.push({
      id: task.id,
      from: { date: from.date, start: from.start },
      to,
      reason: late
        ? 'LATE_PREDECESSOR'
        : span.start < before
          ? 'EARLIER'
          : 'QUEUE',
      by: late ? by : null,
    });
  }
  return moves;
}
