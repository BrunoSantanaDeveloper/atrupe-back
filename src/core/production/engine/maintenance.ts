/**
 * A manutenção que bloqueia a agenda da máquina (GP-49 item 6, ELITE;
 * Maicol, 22/11/2026). O lembrete é o custo fixo do patrimônio: a última
 * ocorrência e "a cada quantos meses". Ligado o bloqueio, cada data da
 * manutenção ocupa a máquina das blockStart por blockMinutes, e a fila do
 * setor não põe trabalho nela nesse período.
 *
 * A tarefa não guarda o patrimônio: guarda a configuração vendida
 * (machineSetupId, o AssetSetup do bem) e o nome da opção vendida em
 * `machine` ("Bem · Configuração", às vezes com " · variação", ou o nome do
 * grupo de máquinas). Por isso o bloqueio leva o bem e as configurações dele,
 * e casa com a tarefa por blocksTask.
 */

export type MaintenanceCost = {
  id: string;
  name: string;
  assetId: string;
  /** O nome do patrimônio, para a tela e para a tarefa antiga */
  machine: string;
  /** As configurações (AssetSetup) do bem */
  setupIds: string[];
  /** YYYY-MM-DD */
  lastOccurrence: string;
  /** A periodicidade, em meses */
  everyMonths: number;
  start: string;
  minutes: number;
};

export type MaintenanceBlock = {
  costId: string;
  name: string;
  assetId: string;
  machine: string;
  setupIds: string[];
  date: string;
  start: string;
  minutes: number;
};

/** A máquina da tarefa, como ela foi gravada na venda. */
export type MaintenanceTask = {
  machine: string | null;
  machineSetupId?: string | null;
};

/**
 * A manutenção para a máquina da tarefa: pela configuração vendida; na
 * tarefa antiga, sem ela, pelo nome do bem igual ou pelo prefixo
 * "Bem · " da opção vendida. A tarefa do grupo de máquinas não sabe qual
 * bem vai usar e não casa.
 */
export const blocksTask = (
  block: Pick<MaintenanceBlock, 'machine' | 'setupIds'>,
  task: MaintenanceTask,
) => {
  if (task.machineSetupId) {
    return (block.setupIds ?? []).includes(task.machineSetupId);
  }
  const machine = task.machine?.trim();
  const asset = block.machine?.trim();
  if (!machine || !asset) return false;
  return machine === asset || machine.startsWith(`${asset} · `);
};

/**
 * Os períodos do dia em que a máquina da tarefa está em manutenção, em
 * minutos do dia, na ordem.
 */
export const maintenanceSpans = (
  blocks: MaintenanceBlock[],
  task: MaintenanceTask,
  day: string,
) =>
  blocks
    .filter((block) => block.date === day && blocksTask(block, task))
    .map((block) => {
      const [hours, minutes] = block.start.split(':').map(Number);
      const from = (hours || 0) * 60 + (minutes || 0);
      return { name: block.name, from, to: from + block.minutes };
    })
    .sort((a, b) => a.from - b.from);

/** A data meses depois, presa ao último dia do mês (31/01 + 1 = 28/02). */
export const addMonths = (day: string, months: number) => {
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
};

/** As datas da manutenção entre from e to (inclusive), a partir da última. */
export function maintenanceBlocks(
  costs: MaintenanceCost[],
  from: string,
  to: string,
): MaintenanceBlock[] {
  const blocks: MaintenanceBlock[] = [];
  for (const cost of costs) {
    const step = Math.max(1, Math.round(cost.everyMonths));
    if (!(cost.minutes > 0)) continue;
    for (let k = 0, day = cost.lastOccurrence; day <= to && k < 600; k++) {
      day = addMonths(cost.lastOccurrence, k * step);
      if (day > to) break;
      if (day >= from) {
        blocks.push({
          costId: cost.id,
          name: cost.name,
          assetId: cost.assetId,
          machine: cost.machine,
          setupIds: cost.setupIds,
          date: day,
          start: cost.start,
          minutes: cost.minutes,
        });
      }
    }
  }
  return blocks.sort((a, b) =>
    `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`),
  );
}
