/**
 * O que não foi feito num bloco passa para o seguinte (Maicol, 24/11/2026):
 * "se não for feita as duas horas da segunda, as duas horas passam para
 * terça". Roda na virada do dia, para os blocos de dias que já passaram.
 *
 * - Feito em parte: o bloco fica com o que foi feito e o resto vai para o
 *   bloco seguinte.
 * - Nada feito: o bloco sai e todo o tempo vai para o seguinte; o bloco
 *   principal (o agendamento da tarefa) assume o dia do seguinte.
 * - Sem bloco seguinte: o resto vai para o primeiro dia útil a partir de
 *   hoje (o bloco anda para lá, ou nasce um novo com o resto).
 *
 * Juntar os blocos de volta continua possível enquanto a tarefa não começou.
 * Pura: o serviço grava.
 */

export type CarryBlock = {
  /** 'main' é o agendamento da própria tarefa; os outros, os blocos */
  id: string;
  date: string;
  start: string | null;
  minutes: number;
  /** O tempo apontado no bloco */
  worked: number;
};

export type CarryOp =
  | { kind: 'minutes'; id: string; minutes: number }
  | {
      kind: 'move';
      id: string;
      date: string;
      start: string | null;
      minutes: number;
    }
  | { kind: 'delete'; id: string }
  | { kind: 'create'; date: string; minutes: number };

export function carrySlots(input: {
  blocks: CarryBlock[];
  today: string;
  /** O primeiro dia útil a partir de hoje (ele mesmo, se for) */
  firstWorkDay: string;
}): CarryOp[] {
  const blocks = [...input.blocks]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.id === 'main' ? -1 : b.id === 'main' ? 1 : 0),
    )
    .map((block) => ({ ...block }));
  const ops: CarryOp[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.date >= input.today) break;
    const worked = Math.max(0, Math.round(block.worked));
    const rest = block.minutes - worked;
    if (rest <= 0) continue;
    const next = blocks[index + 1];
    if (!next) {
      if (worked === 0) {
        ops.push({
          kind: 'move',
          id: block.id,
          date: input.firstWorkDay,
          start: null,
          minutes: block.minutes,
        });
      } else {
        ops.push({ kind: 'minutes', id: block.id, minutes: worked });
        ops.push({ kind: 'create', date: input.firstWorkDay, minutes: rest });
      }
      continue;
    }
    if (worked > 0) {
      ops.push({ kind: 'minutes', id: block.id, minutes: worked });
      next.minutes += rest;
      ops.push({ kind: 'minutes', id: next.id, minutes: next.minutes });
      continue;
    }
    if (block.id === 'main') {
      // O principal assume o dia do seguinte, com todo o tempo
      ops.push({
        kind: 'move',
        id: 'main',
        date: next.date,
        start: next.start,
        minutes: block.minutes + next.minutes,
      });
      ops.push({ kind: 'delete', id: next.id });
      // O seguinte vira o principal para o próximo passo
      blocks[index + 1] = {
        ...next,
        id: 'main',
        minutes: block.minutes + next.minutes,
        worked: next.worked,
      };
      continue;
    }
    ops.push({ kind: 'delete', id: block.id });
    next.minutes += rest;
    ops.push({ kind: 'minutes', id: next.id, minutes: next.minutes });
  }
  return ops;
}
