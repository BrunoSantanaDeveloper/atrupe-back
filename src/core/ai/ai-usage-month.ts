/**
 * O mês da cota do assistente de IA, no fuso de São Paulo (sem horário de
 * verão desde 2019: o deslocamento é sempre -03:00). Função pura para o
 * controle de plano usar sem depender do módulo de IA.
 */
const MONTH_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
});

/** "2026-10" */
export function aiUsageMonth(date = new Date()): string {
  const parts = MONTH_FORMAT.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

export const isAiUsageMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** O começo do mês seguinte, quando a cota renova (meia-noite em São Paulo). */
export function aiQuotaRenewsAt(month: string): Date {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return new Date(
    `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00-03:00`,
  );
}
