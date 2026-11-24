import { soldMaterials } from './lot-task';

/**
 * A baixa conjunta (VS-2; Maicol, 23/11/2026, FULL): vários trabalhos numa
 * impressão só, no mesmo rolo. O comprimento usado (com o refugo) é dividido
 * entre os trabalhos na proporção da área de cada um, como o km das saídas.
 */
const AREA = /m²|m2/i;

/**
 * A área vendida do trabalho (m²) que sai deste rolo; sem ela, nulo.
 *
 * Conta um material só: o vendido que o rolo substitui (a troca, VS-1.1)
 * ou, sem troca, o do próprio rolo. A etapa costuma vender mais de um
 * material em m² (a lona e a laminação, o adesivo e a máscara), e somar
 * todos dobrava a área do trabalho: o rolo da lona não imprime a
 * laminação. A área que importa para dividir o comprimento é a do material
 * que passou na máquina, e ela é a mesma do material que ele substitui.
 */
export function areaOf(
  consumption: unknown,
  keys: { replaces: string | null; lot: string },
): number | null {
  const sold = soldMaterials(consumption);
  const item =
    (keys.replaces && sold.find((row) => row.key === keys.replaces)) ||
    sold.find((row) => row.key === keys.lot);
  return item && AREA.test(item.unit) && item.quantity !== null
    ? item.quantity
    : null;
}

export type BatchShare = { id: string; length: number; weight: number };

/**
 * O comprimento de cada trabalho: pela área de cada um; se algum não tem
 * área, em partes iguais. A soma fecha no comprimento informado.
 */
export function batchShares(
  tasks: { id: string; area: number | null }[],
  length: number,
): BatchShare[] {
  const byArea = tasks.every((task) => task.area !== null && task.area > 0);
  const weights = tasks.map((task) => (byArea ? (task.area as number) : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let used = 0;
  return tasks.map((task, index) => {
    const last = index === tasks.length - 1;
    const share = last
      ? Math.round((length - used) * 1000) / 1000
      : Math.round(((length * weights[index]) / total) * 1000) / 1000;
    used += share;
    return { id: task.id, length: share, weight: weights[index] };
  });
}

/** A área impressa, a gasta e o refugo (m² e %), quando há área. */
export function batchWaste(tasks: { area: number | null }[], usedArea: number) {
  if (!tasks.every((task) => task.area !== null)) return null;
  const printed = tasks.reduce((sum, task) => sum + (task.area as number), 0);
  const waste = Math.max(usedArea - printed, 0);
  return {
    printed: Math.round(printed * 1000) / 1000,
    used: Math.round(usedArea * 1000) / 1000,
    waste: Math.round(waste * 1000) / 1000,
    percent: usedArea > 0 ? Math.round((waste / usedArea) * 1000) / 10 : 0,
  };
}
