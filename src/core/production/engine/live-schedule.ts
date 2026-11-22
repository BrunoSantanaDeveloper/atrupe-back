/**
 * A agenda viva gravada (GP-48 item 20, "Reagenda e avisa"; Maicol,
 * 22/11/2026: "pode gravar"). Quando um trabalho sai da máquina (concluído
 * ou passado para a etapa seguinte), os seguintes do mesmo dia e da mesma
 * máquina que já não cabem no horário agendado andam para depois dele, na
 * sequência, com o intervalo entre tarefas (GP-20). Só empurra: o que cabe
 * fica onde está, e nada é puxado para mais cedo.
 *
 * O intervalo (almoço): na sequência, ninguém começa dentro dele; a máquina
 * que segue no intervalo termina o que começou, e a equipe que para termina
 * mais tarde. Pura: o serviço grava e registra no histórico.
 */

export type LiveHours = {
  breakStart: string | null;
  breakEnd: string | null;
  runsThroughBreak: boolean;
};

export type LiveTask = {
  id: string;
  /** "HH:MM" agendado */
  start: string;
  minutes: number;
};

export type LiveMove = { id: string; from: string; to: string };

export const toMinutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const hhmm = (minutes: number) => {
  const value = Math.max(0, Math.min(Math.round(minutes), 24 * 60 - 1));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

export function rescheduleAfter(input: {
  /** A partir de quando a máquina está livre, em minutos do dia */
  freeAt: number;
  intervalMinutes: number;
  hours: LiveHours;
  /** Os trabalhos não iniciados do dia, na máquina */
  tasks: LiveTask[];
}): LiveMove[] {
  const { hours, intervalMinutes } = input;
  const breakStart = hours.breakStart ? toMinutes(hours.breakStart) : null;
  const breakEnd = hours.breakEnd ? toMinutes(hours.breakEnd) : null;
  const hasBreak = breakStart !== null && breakEnd !== null;
  const moves: LiveMove[] = [];
  let cursor = input.freeAt + intervalMinutes;
  const ordered = [...input.tasks].sort(
    (a, b) => toMinutes(a.start) - toMinutes(b.start),
  );
  for (const task of ordered) {
    const planned = toMinutes(task.start);
    let begin = planned;
    if (cursor > planned) {
      begin = cursor;
      if (hasBreak && begin >= breakStart! && begin < breakEnd!) {
        begin = breakEnd!;
      }
      // Passa da meia-noite: fica para quem agenda resolver
      if (begin >= 24 * 60) break;
      moves.push({ id: task.id, from: task.start, to: hhmm(begin) });
    }
    let finish = begin + Math.max(task.minutes, 0);
    const crosses = hasBreak && begin < breakStart! && finish > breakStart!;
    if (crosses && !hours.runsThroughBreak) finish += breakEnd! - breakStart!;
    cursor = finish + intervalMinutes;
    if (crosses && hours.runsThroughBreak) cursor = Math.max(cursor, breakEnd!);
  }
  return moves;
}
