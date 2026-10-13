import { CostCriterion } from '@prisma/client';
import { monthsUpTo, shiftMonth } from './months';

/**
 * As despesas administrativas (DC-17, BC-T5, BC-T6): o realizado da conta no
 * último mês completo e as médias de 3, 6 e 12 meses, e o custo mensal de
 * referência pelo critério da conta. Valores em centavos.
 */

export type ExpenseStats = {
  lastMonth: number | null;
  avg3: number | null;
  avg6: number | null;
  avg12: number | null;
};

/**
 * `byMonth` é o realizado da conta por mês; `firstMonth`, o primeiro mês com
 * lançamento nela. A média de N meses só existe com N meses de histórico
 * (antes disso, nula); o mês sem lançamento dentro do histórico conta zero.
 */
export const statsOf = (
  byMonth: Map<string, number>,
  firstMonth: string | null,
  reference: string,
): ExpenseStats => {
  const covers = (count: number) =>
    firstMonth !== null && firstMonth <= shiftMonth(reference, -(count - 1));
  const average = (count: number) =>
    covers(count)
      ? Math.round(
          monthsUpTo(reference, count).reduce(
            (sum, month) => sum + (byMonth.get(month) ?? 0),
            0,
          ) / count,
        )
      : null;
  return {
    lastMonth: covers(1) ? Math.round(byMonth.get(reference) ?? 0) : null,
    avg3: average(3),
    avg6: average(6),
    avg12: average(12),
  };
};

/**
 * O critério da conta que ninguém escolheu: a média mais longa que já tem
 * histórico, senão o último mês.
 */
export const defaultCriterionOf = (stats: ExpenseStats): CostCriterion =>
  stats.avg12 !== null
    ? 'AVG_12'
    : stats.avg6 !== null
      ? 'AVG_6'
      : stats.avg3 !== null
        ? 'AVG_3'
        : 'LAST_MONTH';

/** O valor do critério; `MANUAL` é o valor informado. */
export const criterionValueOf = (
  stats: ExpenseStats,
  criterion: CostCriterion,
  manualValue: number | null,
) =>
  ({
    LAST_MONTH: stats.lastMonth,
    AVG_3: stats.avg3,
    AVG_6: stats.avg6,
    AVG_12: stats.avg12,
    MANUAL: manualValue,
  })[criterion];

export type ExpenseShare = { sectorId: string; percentage: number };

/** A parte do custo de referência da conta que vai para um setor (BC-8). */
export const shareValueOf = (referenceValue: number, percentage: number) =>
  Math.round((referenceValue * percentage) / 100);

/** Os percentuais gravados na conta, só os maiores que zero. */
export const sharesOf = (allocations: unknown): ExpenseShare[] =>
  Array.isArray(allocations)
    ? allocations
        .filter(
          (share): share is ExpenseShare =>
            !!share &&
            typeof share.sectorId === 'string' &&
            typeof share.percentage === 'number' &&
            share.percentage > 0,
        )
        .map(({ sectorId, percentage }) => ({ sectorId, percentage }))
    : [];
