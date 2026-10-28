import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { PlanControlService } from '../../plan/plan-control.service';

/**
 * O preço base do item na medida e na quantidade dele (EC-2, ALT-8): o
 * preço do cadastro, sem a edição do vendedor, para a tela comparar com o
 * valor do item e avisar o desconto acima do limite (revisão de 23/10/2026).
 *
 * - item montado na hora (ORC-11): o preço sugerido do motor na medida do
 *   item, guardado no retrato (o preço do item é ele);
 * - material de venda direta: o próprio valor, que vem do cadastro e não se
 *   edita (só o desconto);
 * - produto, com ou sem composição: o preço do cadastro por unidade bruta ×
 *   a medida da linha × a quantidade, como o formulário do item calcula (a
 *   composição do produto escolhe o que produzir, não o preço). A variação
 *   com preço vale no lugar do produto; sem variação, a faixa de quantidade
 *   (FQ-1), com o recurso do plano.
 *
 * Nulo quando não há referência: produto de preço zero (o caso em aberto da
 * ALT-8), linha sem preço no cadastro ou item montado sem retrato.
 */

/** Centavos por unidade comercial → por unidade bruta (mm², mm, s…). */
export const RAW_UNITS: Record<string, number> = {
  AREA: 1_000_000,
  LENGTH: 1000,
  CAPACITY: 1000,
  WEIGHT: 1_000_000,
  DISTANCE: 1000,
  DURATION: 3600,
};

const toRaw = (unitKind: string, cents: number) =>
  cents / (RAW_UNITS[unitKind] ?? 1);

export type Row = {
  unitKind?: string | null;
  quantity?: number | null;
  width?: number | null;
  height?: number | null;
  length?: number | null;
  volume?: number | null;
  weight?: number | null;
  distance?: number | null;
  duration?: number | null;
  productItem?: { unitCost?: number | null } | null;
};

/** A medida bruta da linha pela unidade (mm², mm, ml, mg, m, s). */
export function rawMeasure(row: Row, unitKind: string) {
  switch (unitKind) {
    case 'AREA':
      return (row.width ?? 0) * (row.height ?? 0);
    case 'LENGTH':
      return row.length ?? 0;
    case 'CAPACITY':
      return row.volume ?? 0;
    case 'WEIGHT':
      return row.weight ?? 0;
    case 'DISTANCE':
      return row.distance ?? 0;
    case 'DURATION':
      return row.duration ?? 0;
    default:
      return 1;
  }
}

/**
 * A medida vendida do item na unidade bruta da linha (mm², mm, ml, mg, m, s
 * ou unidade), com a quantidade, somada das linhas: a mesma conta do
 * formulário do item (a de uma linha leva a quantidade dela; a de várias, a
 * dela × a do item). É o que multiplica um preço ou custo por unidade bruta.
 */
export function soldMeasureOf(item: {
  quantity?: number | null;
  items?: Row[] | null;
}) {
  const rows = item.items ?? [];
  const single = rows.length === 1;
  return rows.reduce((sum, row) => {
    const quantity = single
      ? (row.quantity ?? 1)
      : (row.quantity ?? 1) * (item.quantity ?? 1);
    return sum + rawMeasure(row, row.unitKind ?? 'UNITY') * quantity;
  }, 0);
}

export type BasePriceContext = {
  /** O preço sugerido do retrato do item montado na hora (centavos) */
  suggested: Map<string, number>;
  /** As faixas de quantidade valem: o plano tem a composição (FQ-1) */
  tiers: boolean;
};

export type BasePriceItem = {
  id: string;
  origin?: string | null;
  quantity?: number | null;
  totalValue?: number | null;
  variation?: { unitPrice?: number | null } | null;
  product?: {
    priceTiers?: { from: number; unitPrice: number }[] | null;
  } | null;
  items?: Row[] | null;
};

export function basePriceOf(
  item: BasePriceItem,
  context: BasePriceContext,
): number | null {
  const positive = (value: number) => (value > 0 ? Math.round(value) : null);

  if (item.origin === 'COMPOSED') {
    const suggested = context.suggested.get(item.id);
    return suggested === undefined ? null : positive(suggested);
  }
  if (item.origin === 'MATERIAL') return positive(item.totalValue ?? 0);

  const rows = item.items ?? [];
  if (!rows.length) return null;
  const single = rows.length === 1;
  const tiers = context.tiers ? (item.product?.priceTiers ?? []) : [];
  let total = 0;
  for (const row of rows) {
    const unitKind = row.unitKind ?? 'UNITY';
    const rowQuantity = row.quantity ?? 1;
    let unit = row.productItem?.unitCost ?? null;
    // Variação e faixa só no produto de uma linha, como no formulário
    if (single && item.variation) {
      if (
        item.variation.unitPrice !== null &&
        item.variation.unitPrice !== undefined
      ) {
        unit = toRaw(unitKind, item.variation.unitPrice);
      }
    } else if (single && tiers.length) {
      const tier = [...tiers]
        .sort((a, b) => b.from - a.from)
        .find((candidate) => rowQuantity >= candidate.from);
      if (tier) unit = toRaw(unitKind, tier.unitPrice);
    }
    if (unit === null || unit === undefined) return null;
    const quantity = single ? rowQuantity : rowQuantity * (item.quantity ?? 1);
    total += unit * rawMeasure(row, unitKind) * quantity;
  }
  return positive(total);
}

/**
 * O que a conta do preço base lê de cada item (o mesmo que o detalhe lê),
 * mais o valor final, o acréscimo e as linhas para o limite de desconto.
 */
export const BASE_PRICE_ITEM_SELECT = {
  id: true,
  origin: true,
  quantity: true,
  totalValue: true,
  finalValue: true,
  addition: true,
  linesTotal: true,
  variation: { select: { unitPrice: true } },
  product: {
    select: {
      priceTiers: {
        where: { variationId: null },
        select: { from: true, unitPrice: true },
      },
    },
  },
  items: {
    select: {
      unitKind: true,
      quantity: true,
      width: true,
      height: true,
      length: true,
      volume: true,
      weight: true,
      distance: true,
      duration: true,
      productItem: { select: { unitCost: true } },
    },
  },
} as const;

/**
 * O desconto do orçamento sobre a soma dos preços base (ALT-8, EC-2), a
 * mesma conta da tela (lib/discountLimit): a soma das bases dos itens com
 * preço base contra o que esses itens valem (o valor final, sem o acréscimo
 * e as linhas, ALT-25 e ORC-5), mais o desconto geral das condições. Item
 * acima da base compensa desconto em outro; item sem preço base fica fora.
 */
export function discountOverBase(
  items: (BasePriceItem & {
    finalValue?: number | null;
    addition?: number | null;
    linesTotal?: number | null;
  })[],
  context: BasePriceContext,
  generalDiscount = 0,
) {
  let base = 0;
  let effective = 0;
  for (const item of items) {
    const itemBase = basePriceOf(item, context) ?? 0;
    if (itemBase <= 0) continue;
    base += itemBase;
    effective +=
      (item.finalValue || 0) - (item.addition || 0) - (item.linesTotal || 0);
  }
  const discount = Math.max(base - effective + (generalDiscount || 0), 0);
  const percentage =
    base > 0
      ? Math.round(((discount / base) * 100 + Number.EPSILON) * 100) / 100
      : 0;
  return { base, discount, percentage };
}

/**
 * O que a conta precisa além do item: o preço sugerido dos retratos (só
 * ele; o retrato tem custo e não sai para a tela, ORC-7) e se as faixas
 * valem no plano da empresa.
 */
export async function basePriceContext(
  prisma: PrismaService,
  planControl: PlanControlService | undefined,
  companyId: string,
  itemIds: string[],
): Promise<BasePriceContext> {
  const [rows, tiers] = await Promise.all([
    itemIds.length
      ? prisma.$queryRaw<{ id: string; suggested: number | null }[]>`
          SELECT "quotationProductId" AS id,
                 ("data"->>'suggestedPrice')::float AS suggested
          FROM "quotation_item_snapshots"
          WHERE "quotationProductId" IN (${Prisma.join(itemIds)})`
      : Promise.resolve([]),
    planControl
      ? planControl
          .hasFeature(companyId, 'product_composition')
          .catch(() => false)
      : Promise.resolve(false),
  ]);
  return {
    suggested: new Map(
      rows
        .filter((row) => row.suggested !== null)
        .map((row) => [row.id, Number(row.suggested)]),
    ),
    tiers,
  };
}
