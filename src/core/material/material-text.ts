import { MaterialUnit } from '@prisma/client';

/**
 * Minúsculas, sem acento e com os espaços colapsados: a busca, o de-para da
 * importação e a combinação marca × cor comparam o texto assim.
 */
export const normalizeText = (value: string | null | undefined): string =>
  (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A unidade como as planilhas escrevem, já normalizada, para a do cadastro. */
const UNIT_ALIASES: Record<string, MaterialUnit> = {
  m2: 'M2',
  'm²': 'M2',
  mq: 'M2',
  'metro quadrado': 'M2',
  m: 'M',
  ml: 'M',
  metro: 'M',
  'metro linear': 'M',
  un: 'UN',
  und: 'UN',
  unid: 'UN',
  unidade: 'UN',
  pc: 'UN',
  folha: 'UN',
  chapa: 'UN',
  kg: 'KG',
  quilo: 'KG',
  l: 'LT',
  lt: 'LT',
  litro: 'LT',
  h: 'HR',
  hr: 'HR',
  hora: 'HR',
  km: 'KM',
};

export const unitFromText = (
  value: string | null | undefined,
): MaterialUnit | null => UNIT_ALIASES[normalizeText(value)] ?? null;

/** A sigla da unidade, como a Precificação e a composição mostram. */
export const UNIT_SYMBOL: Record<MaterialUnit, string> = {
  M2: 'm²',
  M: 'm',
  UN: 'un',
  KG: 'kg',
  LT: 'l',
  HR: 'h',
  KM: 'km',
};

/** `MAT-nn`, sequencial por empresa. */
export const materialCode = (number: number): string =>
  `MAT-${String(number).padStart(2, '0')}`;

/** A combinação marca × cor: única no material, sem caixa e sem acento. */
export const variationKey = (brand: string, color: string): string =>
  `${normalizeText(brand)}|${normalizeText(color)}`;
