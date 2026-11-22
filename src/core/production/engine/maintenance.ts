/**
 * A manutenção que bloqueia a agenda da máquina (GP-49 item 6, ELITE;
 * Maicol, 22/11/2026). O lembrete é o custo fixo do patrimônio: a última
 * ocorrência e "a cada quantos meses". Ligado o bloqueio, cada data da
 * manutenção ocupa a máquina das blockStart por blockMinutes, e a fila do
 * setor não põe trabalho nela nesse período.
 */

export type MaintenanceCost = {
  id: string;
  name: string;
  /** O nome do patrimônio: é como a tarefa guarda a máquina */
  machine: string;
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
  machine: string;
  date: string;
  start: string;
  minutes: number;
};

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
          machine: cost.machine,
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
