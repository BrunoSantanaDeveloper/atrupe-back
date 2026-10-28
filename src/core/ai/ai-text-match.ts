/**
 * Casar o que a pessoa escreveu com o cadastro, sem o modelo (agente,
 * 28/10/2026): o catálogo nunca vai inteiro ao provedor. O servidor busca os
 * candidatos por nome e código e dá uma nota de 0 a 1 a cada um.
 */

const STOPWORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'com',
  'sem',
  'para',
  'pra',
  'pro',
  'e',
  'um',
  'uma',
  'x',
]);

/** Minúsculas, sem acento e sem pontuação. */
export const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    // '3mm' é '3 mm': número e unidade contam separados
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .trim();

/**
 * As palavras que contam na busca (sem artigo e preposição). O número conta
 * mesmo com um dígito: é ele que separa a placa de 3 mm da de 2 mm.
 */
export const searchTokens = (value: string) =>
  [...new Set(normalizeText(value).split(' '))].filter(
    (token) =>
      (token.length >= 2 || /^[0-9]+$/.test(token)) && !STOPWORDS.has(token),
  );

/**
 * As palavras para o `contains` do banco: a escrita original (com acento) e
 * a normalizada, porque o banco compara acento.
 */
export const queryTokens = (value: string) => {
  const raw = value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
  const normalized = searchTokens(value).filter((token) => token.length >= 2);
  return [...new Set([...raw, ...normalized])].slice(0, 12);
};

/**
 * A nota do candidato: quanto do pedido ele cobre (peso maior) e quanto do
 * nome dele o pedido cobre. Nome ou código igual vale 1.
 */
export function matchScore(
  hint: string,
  candidate: { name: string; code?: string | null; extra?: string[] },
) {
  const hintNorm = normalizeText(hint);
  const names = [candidate.name, ...(candidate.extra ?? [])].filter(Boolean);
  if (candidate.code && normalizeText(candidate.code) === hintNorm) return 1;
  if (names.some((name) => normalizeText(name) === hintNorm)) return 1;

  const hintTokens = searchTokens(hint);
  if (!hintTokens.length) return 0;
  let best = 0;
  for (const name of names) {
    const nameTokens = searchTokens(name);
    if (!nameTokens.length) continue;
    const covered = hintTokens.filter((token) =>
      nameTokens.some((nameToken) => sameToken(token, nameToken)),
    ).length;
    const coveredName = nameTokens.filter((nameToken) =>
      hintTokens.some((token) => sameToken(token, nameToken)),
    ).length;
    best = Math.max(
      best,
      (covered / hintTokens.length) * 0.7 +
        (coveredName / nameTokens.length) * 0.3,
    );
  }
  return Math.round(best * 1000) / 1000;
}

/** Plural simples e número com unidade ("3mm" = "3 mm"). */
function sameToken(a: string, b: string) {
  if (a === b) return true;
  const singular = (token: string) =>
    token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token;
  return singular(a) === singular(b);
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/** Nota mínima para um candidato entrar na lista de escolha. */
export const MIN_CANDIDATE_SCORE = 0.3;
/** Nota e vantagem sobre o segundo para usar o primeiro sem perguntar. */
const CONFIDENT_SCORE = 0.75;
const CONFIDENT_GAP = 0.15;

export function rank<T>(
  hint: string,
  items: T[],
  describe: (item: T) => {
    name: string;
    code?: string | null;
    extra?: string[];
  },
  bonus: (item: T) => number = () => 0,
): Ranked<T>[] {
  return items
    .map((item) => ({
      item,
      score: Math.min(matchScore(hint, describe(item)) + bonus(item), 1),
    }))
    .filter((entry) => entry.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score);
}

/** O primeiro, quando a nota é alta e ele se destaca do segundo. */
export function confidentChoice<T>(ranked: Ranked<T>[]): T | null {
  const [first, second] = ranked;
  if (!first) return null;
  if (first.score >= 1 && (!second || second.score < 1)) return first.item;
  if (first.score < CONFIDENT_SCORE) return null;
  if (second && first.score - second.score < CONFIDENT_GAP) return null;
  return first.item;
}

/**
 * A medida escrita no pedido ("30x40", "2 x 1 m", "300x200mm"), em metros.
 * Sem unidade, dois números de 10 para cima são centímetros (30x40, 90x120)
 * e os menores são metros (2x1, 1,5x0,8).
 */
export function parseDimensions(text: string) {
  const match =
    /(\d+(?:[.,]\d+)?)\s*(cm|mm|m)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m)?(?![a-z])/i.exec(
      text,
    );
  if (!match) return null;
  const first = Number(match[1].replace(',', '.'));
  const second = Number(match[3].replace(',', '.'));
  if (!(first > 0) || !(second > 0)) return null;
  const unit = (
    match[4] ||
    match[2] ||
    (first >= 10 && second >= 10 ? 'cm' : 'm')
  ).toLowerCase();
  const factor = unit === 'cm' ? 0.01 : unit === 'mm' ? 0.001 : 1;
  return {
    width: Math.round(first * factor * 10_000) / 10_000,
    height: Math.round(second * factor * 10_000) / 10_000,
    unit,
  };
}
