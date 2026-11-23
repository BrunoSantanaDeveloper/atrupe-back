/**
 * A agenda viva gravada (GP-48 item 20, "Reagenda e avisa"; Maicol,
 * 22/11/2026: "pode gravar"). Quando um trabalho sai da máquina (concluído
 * ou passado para a etapa seguinte), os seguintes do mesmo dia e da mesma
 * máquina que já não cabem no horário agendado andam para depois dele, na
 * sequência, com o intervalo entre tarefas (GP-20). Só empurra: o que cabe
 * fica onde está, e nada é puxado para mais cedo.
 *
 * O expediente é o efetivo, como a fila mostra: o do gerenciador ou, sem
 * ele, o da empresa (production_calendars). Na sequência:
 * - ninguém começa dentro do intervalo (almoço): a máquina que segue no
 *   intervalo termina o que começou, e a equipe que para termina mais tarde;
 * - ninguém começa dentro da manutenção da máquina (GP-49 item 6): começa
 *   depois dela;
 * - nada é gravado para começar depois do fim do expediente: o que não
 *   começa mais hoje fica para o próximo dia útil, só com o dia (GP-49), e
 *   entra na sequência daquele dia. O que começa antes do fim e passa dele
 *   fica, e a fila mostra o excedente.
 *
 * Pura: o serviço grava e registra no histórico.
 */

export type LiveHours = {
  workStart: string;
  workEnd: string;
  breakStart: string | null;
  breakEnd: string | null;
  runsThroughBreak: boolean;
};

/** A manutenção da máquina no dia, em minutos do dia */
export type LiveBlock = { name: string; from: number; to: number };

export type LiveTask = {
  id: string;
  /** "HH:MM" agendado */
  start: string;
  minutes: number;
};

export type LiveMove = {
  id: string;
  from: string;
  /** "HH:MM" no mesmo dia; nulo: não começa mais hoje, vai ao próximo dia útil */
  to: string | null;
  /** A manutenção que empurrou a tarefa, quando foi ela */
  maintenance: string | null;
};

export const toMinutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const hhmm = (minutes: number) => {
  const value = Math.max(0, Math.min(Math.round(minutes), 24 * 60 - 1));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

/**
 * O expediente que vale no gerenciador: o dele; sem ele, o da empresa. O
 * intervalo do gerenciador vale mesmo sem o horário dele, como na fila.
 */
export const liveHoursOf = (
  manager: {
    workStart: string | null;
    workEnd: string | null;
    breakStart: string | null;
    breakEnd: string | null;
    runsThroughBreak: boolean;
  },
  calendar: {
    startTime: string;
    endTime: string;
    breakStart?: string | null;
    breakEnd?: string | null;
  },
): LiveHours =>
  manager.workStart && manager.workEnd
    ? {
        workStart: manager.workStart,
        workEnd: manager.workEnd,
        breakStart: manager.breakStart,
        breakEnd: manager.breakEnd,
        runsThroughBreak: manager.runsThroughBreak,
      }
    : {
        workStart: calendar.startTime,
        workEnd: calendar.endTime,
        breakStart: manager.breakStart || calendar.breakStart || null,
        breakEnd: manager.breakStart
          ? manager.breakEnd
          : (calendar.breakEnd ?? null),
        runsThroughBreak: manager.runsThroughBreak,
      };

/** O próximo dia de trabalho da empresa depois de day, sem feriado. */
export const nextWorkDay = (
  day: string,
  calendar: { workDays: number[]; holidays: string[] },
) => {
  const date = new Date(`${day}T12:00:00.000Z`);
  for (let count = 0; count < 400; count++) {
    date.setUTCDate(date.getUTCDate() + 1);
    const next = date.toISOString().slice(0, 10);
    if (
      calendar.workDays.includes(date.getUTCDay()) &&
      !calendar.holidays.includes(next)
    ) {
      return next;
    }
  }
  // Sem dia de trabalho no cadastro: o dia seguinte
  const fallback = new Date(`${day}T12:00:00.000Z`);
  fallback.setUTCDate(fallback.getUTCDate() + 1);
  return fallback.toISOString().slice(0, 10);
};

export function rescheduleAfter(input: {
  /** A partir de quando a máquina está livre, em minutos do dia */
  freeAt: number;
  intervalMinutes: number;
  hours: LiveHours;
  /** A manutenção da máquina no dia */
  blocks?: LiveBlock[];
  /** Os trabalhos não iniciados do dia, na máquina */
  tasks: LiveTask[];
}): LiveMove[] {
  const { hours, intervalMinutes } = input;
  const workEnd = toMinutes(hours.workEnd);
  const breakStart = hours.breakStart ? toMinutes(hours.breakStart) : null;
  const breakEnd = hours.breakEnd ? toMinutes(hours.breakEnd) : null;
  const hasBreak = breakStart !== null && breakEnd !== null;
  const blocks = [...(input.blocks ?? [])].sort((a, b) => a.from - b.from);
  const moves: LiveMove[] = [];
  let cursor = input.freeAt + intervalMinutes;
  const ordered = [...input.tasks].sort(
    (a, b) => toMinutes(a.start) - toMinutes(b.start),
  );
  for (const task of ordered) {
    const planned = toMinutes(task.start);
    const minutes = Math.max(task.minutes, 0);
    // O trecho da tarefa a partir de from; empurrada, não começa no intervalo
    const span = (from: number, pushed: boolean) => {
      let begin = from;
      if (pushed && hasBreak && begin >= breakStart! && begin < breakEnd!) {
        begin = breakEnd!;
      }
      let finish = begin + minutes;
      const crosses = hasBreak && begin < breakStart! && finish > breakStart!;
      if (crosses && !hours.runsThroughBreak) {
        finish += breakEnd! - breakStart!;
      }
      return { begin, finish, crosses };
    };
    let real = span(Math.max(planned, cursor), cursor > planned);
    // A manutenção da máquina: a tarefa começa depois dela
    let stop: LiveBlock | null = null;
    for (let guard = 0; guard < blocks.length; guard++) {
      const block = blocks.find(
        (item) => real.begin < item.to && real.finish > item.from,
      );
      if (!block) break;
      stop = block;
      real = span(block.to, true);
    }
    if (real.begin !== planned) {
      const maintenance = stop?.name ?? null;
      if (real.begin >= workEnd) {
        // Não começa mais hoje: vai ao próximo dia útil e não ocupa a
        // máquina hoje
        moves.push({ id: task.id, from: task.start, to: null, maintenance });
        continue;
      }
      moves.push({
        id: task.id,
        from: task.start,
        to: hhmm(real.begin),
        maintenance,
      });
    }
    cursor = real.finish + intervalMinutes;
    if (real.crosses && hours.runsThroughBreak) {
      cursor = Math.max(cursor, breakEnd!);
    }
  }
  return moves;
}
