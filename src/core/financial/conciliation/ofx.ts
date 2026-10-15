/**
 * Lê o extrato em OFX (CX-6): o arquivo que todo banco exporta, no formato
 * SGML do OFX 1.x (sem as etiquetas de fechamento) ou no XML do OFX 2.x.
 * Cada lançamento vem com o identificador do próprio banco (FITID), que
 * evita duplicar o extrato importado de novo. Valores em centavos, com sinal.
 */

export type OfxLine = {
  fitId: string;
  /** O dia do lançamento, AAAA-MM-DD */
  date: string;
  /** Centavos: positivo entra, negativo sai */
  amount: number;
  memo: string;
};

export type OfxStatement = {
  bankId: string | null;
  accountId: string | null;
  lines: OfxLine[];
};

export class OfxError extends Error {}

/** O valor da etiqueta: até a próxima etiqueta (SGML) ou até o fechamento. */
const field = (block: string, name: string): string | null => {
  const match = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
  return match ? match[1].trim() : null;
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const decode = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]);

/** 20260928120000[-3:BRT] → 2026-09-28 */
const dayOf = (value: string | null) => {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value ?? '');
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
};

/** "-12.90", "1.200,00" e "1200" → centavos */
const centsOf = (value: string | null) => {
  if (!value) return null;
  let text = value.trim();
  // Vírgula como decimal (alguns bancos brasileiros)
  if (/,\d{1,2}$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  const number = Number(text);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
};

export function parseOfx(content: string): OfxStatement {
  const text = content ?? '';
  if (!/<OFX>/i.test(text) || !/<STMTTRN>/i.test(text)) {
    if (/<OFX>/i.test(text))
      return { bankId: null, accountId: null, lines: [] };
    throw new OfxError('O arquivo não é um extrato OFX');
  }
  const lines: OfxLine[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>/i)[0];
    const date = dayOf(field(block, 'DTPOSTED'));
    const amount = centsOf(field(block, 'TRNAMT'));
    if (!date || amount === null) continue;
    const memo = decode(field(block, 'MEMO') ?? field(block, 'NAME') ?? '');
    // Sem FITID (raro), o próprio lançamento vira a chave
    const fitId =
      field(block, 'FITID') || `${date}|${amount}|${memo}`.slice(0, 180);
    lines.push({ fitId, date, amount, memo });
  }
  return {
    bankId: field(text, 'BANKID'),
    accountId: field(text, 'ACCTID'),
    lines,
  };
}

/** Dias úteis entre duas datas AAAA-MM-DD (sábado e domingo não contam). */
export function businessDaysBetween(a: string, b: string) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  let days = 0;
  for (let day = new Date(start); day < end; ) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days++;
  }
  return days;
}
