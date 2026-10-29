import { RAW_UNITS, Row, rawMeasure } from './item-base-price';

/**
 * O preço do item na medida e na quantidade dele, a mesma conta do formulário
 * do item (QuotationProdDetailModal), agora também no servidor (agente de IA,
 * 28/10/2026: nenhum valor em dinheiro sai do modelo):
 *
 * - item simples (produto de uma linha): o preço do cadastro por unidade
 *   bruta; com variação escolhida, o preço dela; sem variação, a faixa de
 *   quantidade (FQ-1), com o recurso do plano. Abaixo da quantidade mínima do
 *   produto, cobra o mínimo; abaixo da venda mínima por item da empresa
 *   (GR-4, com o recurso do plano), cobra a venda mínima — vale o maior;
 * - produto de várias linhas: cada linha na medida do cadastro × a
 *   quantidade do item, sem variação, faixa nem mínimos (como na tela).
 *
 * Valores em centavos; a medida bruta é a do formulário (mm, mm², ml, mg,
 * m, s).
 */

/** A unidade comercial de cada tipo de medida, como o agente escreve. */
export const COMMERCIAL_UNIT: Record<string, string> = {
  UNITY: 'un',
  AREA: 'm2',
  LENGTH: 'm',
  CAPACITY: 'l',
  WEIGHT: 'kg',
  DISTANCE: 'km',
  DURATION: 'h',
};

const UNIT_LABEL: Record<string, string> = {
  UNITY: 'un',
  AREA: 'm²',
  LENGTH: 'm',
  CAPACITY: 'l',
  WEIGHT: 'kg',
  DISTANCE: 'km',
  DURATION: 'h',
};

/** Unidade bruta por unidade comercial (1 m² = 1.000.000 mm²). */
export const rawPerUnit = (unitKind: string) => RAW_UNITS[unitKind] ?? 1;

const amount = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export interface SimpleItemPriceInput {
  unitKind: string;
  /** O unitCost da linha do produto: centavos por unidade bruta */
  catalogUnitCost: number | null;
  /** A medida da linha, em unidade bruta */
  measure: Omit<Row, 'unitKind' | 'quantity' | 'productItem'>;
  /** A quantidade da linha */
  quantity: number;
  /** A variação escolhida: preço em centavos por unidade comercial */
  variation?: { name: string; unitPrice: number | null } | null;
  /** As faixas do produto (sem variação), em centavos por unidade comercial */
  tiers?: { from: number; unitPrice: number }[];
  /** A quantidade mínima do produto, na unidade comercial */
  minQuantity?: number | null;
}

export interface ItemPrice {
  /** Centavos por unidade bruta: o unitCost da linha do item */
  rawUnitCost: number;
  /** Centavos por unidade comercial (m², un…) */
  unitPrice: number;
  /** A medida vendida, na unidade comercial (área somada, unidades…) */
  soldQuantity: number;
  /** A medida cobrada: a mínima, quando maior */
  chargedQuantity: number;
  total: number;
  /** As regras que valeram, para a pessoa conferir */
  rules: string[];
}

export function priceSimpleItem(input: SimpleItemPriceInput): ItemPrice | null {
  const { unitKind } = input;
  const perUnit = rawPerUnit(unitKind);
  const rules: string[] = [];
  let rawUnitCost = input.catalogUnitCost;

  if (input.variation) {
    if (
      input.variation.unitPrice !== null &&
      input.variation.unitPrice !== undefined
    ) {
      rawUnitCost = input.variation.unitPrice / perUnit;
    }
    rules.push(`variação ${input.variation.name}`);
  } else if (input.tiers?.length) {
    const tier = [...input.tiers]
      .sort((a, b) => b.from - a.from)
      .find((candidate) => input.quantity >= candidate.from);
    if (tier) {
      rawUnitCost = tier.unitPrice / perUnit;
      rules.push(`faixa ${tier.from}+`);
    }
  }
  if (rawUnitCost === null || rawUnitCost === undefined) return null;

  const measured =
    rawMeasure({ ...input.measure, unitKind }, unitKind) * input.quantity;
  const minRaw =
    input.minQuantity && input.minQuantity > 0
      ? input.minQuantity * perUnit
      : 0;
  const charged = Math.max(measured, minRaw);
  if (minRaw > measured) {
    rules.push(
      `quantidade mínima de ${amount(input.minQuantity)} ${UNIT_LABEL[unitKind] ?? 'un'}`,
    );
  }

  const total = rawUnitCost * charged;

  return {
    rawUnitCost,
    unitPrice: Math.round(rawUnitCost * perUnit),
    soldQuantity: measured / perUnit,
    chargedQuantity: charged / perUnit,
    total: Math.round(total),
    rules,
  };
}

/** O produto de várias linhas: a medida do cadastro × a quantidade. */
export function priceMultiRowItem(
  rows: (Row & { unitCost?: number | null })[],
  quantity: number,
): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.unitCost === null || row.unitCost === undefined) return null;
    total += row.unitCost * rawMeasure(row, row.unitKind ?? 'UNITY') * quantity;
  }
  return Math.round(total);
}
