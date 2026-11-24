/**
 * Os blocos de agenda da tarefa (GP-52; Maicol, 23/11/2026, ELITE). O
 * agendamento da tarefa (scheduleDate, scheduleStart, scheduleMinutes) é o
 * bloco 1; os outros ficam em production_task_slots: o resto de um trabalho
 * dividido em dois dias (NORMAL) e o tempo acrescentado com motivo (EXTRA).
 *
 * A fila, a agenda, a cadeia e o mapa de ocupação leem os blocos daqui
 * (a agenda viva lê os de hoje no banco), para cada dia contar o que é dele
 * e a soma dar o total:
 * dividir 480 min em 240 + 240 ocupa 240 em cada dia. Sem o bloco 1 (tirada
 * da agenda), a tarefa não tem bloco nenhum.
 *
 * Puro.
 */

export type SlotKind = 'NORMAL' | 'EXTRA';

export type BlockSlot = {
  id: string;
  date: Date | string;
  start: string | null;
  minutes: number;
  kind: SlotKind;
  reason?: string | null;
};

export type BlockTask = {
  scheduleDate: Date | string | null;
  scheduleStart?: string | null;
  scheduleMinutes: number | null;
  estimatedMinutes: number;
  /** O preparo, que ocupa a máquina junto com a produção */
  setupMinutes?: number;
  slots?: BlockSlot[];
};

export type TaskBlock = {
  /** Nulo no bloco 1, o agendamento da tarefa */
  slotId: string | null;
  /** YYYY-MM-DD */
  date: string;
  /** "HH:MM"; nulo: só o dia (GP-49) */
  start: string | null;
  minutes: number;
  kind: SlotKind;
  reason: string | null;
};

/** O dia gravado (coluna date): o dia em UTC é o dia gravado. */
const dayOf = (value: Date | string) =>
  typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);

const others = (task: BlockTask) =>
  [...(task.slots ?? [])].sort((a, b) =>
    `${dayOf(a.date)} ${a.start ?? '99:99'}`.localeCompare(
      `${dayOf(b.date)} ${b.start ?? '99:99'}`,
    ),
  );

const blocksWith = (task: BlockTask, firstMinutes: number): TaskBlock[] => {
  if (!task.scheduleDate) return [];
  return [
    {
      slotId: null,
      date: dayOf(task.scheduleDate),
      start: task.scheduleStart || null,
      minutes: firstMinutes,
      kind: 'NORMAL',
      reason: null,
    },
    ...others(task).map((slot) => ({
      slotId: slot.id,
      date: dayOf(slot.date),
      start: slot.start || null,
      minutes: Math.max(slot.minutes, 0),
      kind: slot.kind,
      reason: slot.reason ?? null,
    })),
  ];
};

/**
 * Os blocos como a tela mostra (a duração agendada): o bloco 1 com o que
 * ficou nele (o agendado ou, só com o dia, o previsto), depois os outros
 * por dia e hora.
 */
export const scheduleBlocks = (task: BlockTask) =>
  blocksWith(
    task,
    task.scheduleMinutes || Math.max(task.estimatedMinutes ?? 0, 0),
  );

/**
 * Os blocos como a máquina e o setor ficam ocupados. Sem outros blocos, o
 * bloco 1 ocupa o maior entre o previsto, o preparo e o agendado (a conta
 * de sempre). Com outros blocos, o bloco 1 ocupa só o que ficou nele (o
 * agendado; só com o dia, o previsto ou o preparo) e cada bloco, o dele.
 */
export const occupiedBlocks = (task: BlockTask) => {
  const work = Math.max(task.estimatedMinutes ?? 0, task.setupMinutes ?? 0, 0);
  const first = task.slots?.length
    ? task.scheduleMinutes || work
    : Math.max(work, task.scheduleMinutes ?? 0);
  return blocksWith(task, first);
};

/** O último dia agendado da tarefa, entre todos os blocos. */
export const lastBlockDay = (task: BlockTask) =>
  scheduleBlocks(task).reduce<string | null>(
    (last, block) => (!last || block.date > last ? block.date : last),
    null,
  );

export type MachineSpan = {
  taskId: string;
  machine: string | null;
  date: string;
  /** Em minutos do dia; nulo: só o dia, sem horário para sobrepor */
  start: number | null;
  end: number | null;
  /** O intervalo do gerenciador entre tarefas na mesma máquina (GP-20) */
  interval: number;
};

/**
 * As tarefas com a mesma máquina ocupada ao mesmo tempo, bloco a bloco, no
 * dia de cada bloco e contando o intervalo. Os blocos da mesma tarefa não
 * conflitam entre si.
 */
export function machineConflicts(spans: MachineSpan[]) {
  const conflicts = new Set<string>();
  for (const span of spans) {
    if (!span.machine || span.start === null || span.end === null) continue;
    const hit = spans.some(
      (other) =>
        other !== span &&
        other.taskId !== span.taskId &&
        other.start !== null &&
        other.end !== null &&
        other.machine === span.machine &&
        other.date === span.date &&
        other.start < span.end! + span.interval &&
        span.start! < other.end + other.interval,
    );
    if (hit) conflicts.add(span.taskId);
  }
  return conflicts;
}
