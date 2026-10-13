/**
 * Os meses da base de custos, no formato AAAA-MM. O mês de referência é o
 * último mês completo (DC-17): as médias e tudo o que depende delas mudam
 * sozinhos quando um mês fecha.
 */

// São Paulo, sem horário de verão desde 2019
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

const keyOf = (year: number, monthIndex: number) =>
  `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

/** O mês de um instante, no horário de São Paulo. */
export const monthOfInstant = (date: Date) => {
  const local = new Date(date.getTime() - SAO_PAULO_OFFSET_MS);
  return keyOf(local.getUTCFullYear(), local.getUTCMonth());
};

/** O mês de uma data sem horário (gravada à meia-noite UTC, como a competência). */
export const monthOfDate = (date: Date) =>
  keyOf(date.getUTCFullYear(), date.getUTCMonth());

export const shiftMonth = (month: string, delta: number) => {
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) + delta;
  return keyOf(Math.floor(index / 12), index % 12);
};

/** O último mês completo. */
export const referenceMonthOf = (today: Date) =>
  shiftMonth(monthOfInstant(today), -1);

/** Os N meses até o de referência, do mais recente para o mais antigo. */
export const monthsUpTo = (reference: string, count: number) =>
  Array.from({ length: count }, (_, index) => shiftMonth(reference, -index));

/** O primeiro dia do mês, à meia-noite UTC (para filtrar datas sem horário). */
export const monthStart = (month: string) =>
  new Date(`${month}-01T00:00:00.000Z`);
