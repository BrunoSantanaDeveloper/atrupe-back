/**
 * Datas "do dia" no fuso da operação (Brasil), não em UTC.
 *
 * A listagem fiscal agrupava por `createdAt.toISOString().split('T')[0]`, que é
 * a data UTC. Como o Brasil está em UTC-3, uma nota emitida às 21h30 caía no
 * grupo do dia seguinte, e o cabeçalho de grupo exibido ao usuário podia não
 * corresponder ao dia em que ele emitiu. O mesmo vale para o filtro de período:
 * `T00:00:00.000Z` começa o dia às 21h do dia anterior em horário local.
 */
const PROJECT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Data local (YYYY-MM-DD) do instante informado, no fuso da operação.
 * O locale 'en-CA' é usado porque formata exatamente como YYYY-MM-DD.
 */
export function toProjectDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PROJECT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Converte uma data YYYY-MM-DD vinda do filtro para o instante correspondente
 * ao início (ou fim) daquele dia no fuso da operação.
 */
export function parseProjectDayBoundary(
  value: string,
  boundary: 'start' | 'end',
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  // O offset é obtido do próprio fuso para não fixar -03:00 e errar caso o
  // horário de verão volte a existir.
  const reference = new Date(`${value}T12:00:00.000Z`);
  const offset = getProjectOffset(reference);
  const time = boundary === 'start' ? '00:00:00.000' : '23:59:59.999';

  const parsed = new Date(`${value}T${time}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Offset do fuso da operação no formato ±HH:MM, para o instante informado. */
function getProjectOffset(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PROJECT_TIMEZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(date);

  const name = parts.find((part) => part.type === 'timeZoneName')?.value;
  const match = name?.match(/GMT([+-]\d{2}:\d{2})/);
  return match ? match[1] : '-03:00';
}
