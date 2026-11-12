import { Prisma } from '@prisma/client';
import { SheetCount, SheetCountPaper, sheetCountOf } from './sheet-count';

/**
 * A contagem de folhas da gráfica rápida no LITE (12/11/2026), sem custo:
 *
 * - **sangria variável (GR-1.1):** a peça ocupa a folha com a sangria dos
 *   dois lados. Vale a do item, senão a do produto, senão a do setor, senão
 *   2 mm por lado;
 * - **folhas de acerto:** as folhas que a máquina gasta para acertar, por
 *   trabalho, somadas às do pedido. Do produto, senão do setor, senão
 *   nenhuma.
 *
 * Medidas em mm.
 */

export const DEFAULT_BLEED_MM = 2;

/** O que a contagem lê do setor, junto do produto. */
export const PRINT_PRODUCT_RELATIONS = {
  sector: { select: { bleedMm: true, setupSheets: true } },
} satisfies Prisma.ProductInclude;

/** O produto como a contagem lê, para os selects do item. */
export const PRINT_PRODUCT_SELECT = {
  bleedMm: true,
  setupSheets: true,
  ...PRINT_PRODUCT_RELATIONS,
} satisfies Prisma.ProductSelect;

export type BleedSource = 'ITEM' | 'PRODUCT' | 'SECTOR' | 'DEFAULT';

/** O que o item do orçamento guarda (`quotation_products.printSpec`). */
export type PrintSpec = {
  /** Sangria por lado só neste item; nulo = a do produto */
  bleedMm?: number | null;
};

/** O produto como a contagem lê. */
export type PrintProduct = {
  bleedMm: number | null;
  setupSheets: number | null;
  sector?: { bleedMm: number | null; setupSheets: number | null } | null;
};

export type PrintCount = SheetCount & {
  /** A parte impressa; nulo no produto de uma peça só */
  label: string | null;
  /** Peças que vão para a folha */
  impressions: number;
  bleedMm: number;
  bleedSource: BleedSource;
  setupSheets: number;
  /** Folhas do pedido mais as de acerto; nulo quando não dá para contar */
  totalSheets: number | null;
};

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A sangria em uso e de onde ela vem (o item mostra as duas coisas). */
export function bleedOf(
  spec: PrintSpec | null | undefined,
  product: PrintProduct | null | undefined,
): { mm: number; source: BleedSource } {
  if (isNumber(spec?.bleedMm) && spec.bleedMm >= 0) {
    return { mm: spec.bleedMm, source: 'ITEM' };
  }
  if (isNumber(product?.bleedMm) && product.bleedMm >= 0) {
    return { mm: product.bleedMm, source: 'PRODUCT' };
  }
  if (isNumber(product?.sector?.bleedMm) && product.sector.bleedMm >= 0) {
    return { mm: product.sector.bleedMm, source: 'SECTOR' };
  }
  return { mm: DEFAULT_BLEED_MM, source: 'DEFAULT' };
}

export function setupSheetsOf(product: PrintProduct | null | undefined) {
  const value = isNumber(product?.setupSheets)
    ? product.setupSheets
    : product?.sector?.setupSheets;
  return isNumber(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * As contagens do pedido (uma lista: uma contagem por papel). A peça é o
 * tamanho final (o da proposta); na folha ela entra com a sangria.
 */
export function printCounts(input: {
  piece: { width?: number | null; height?: number | null };
  pieces: number;
  paper: SheetCountPaper | null;
  product: PrintProduct | null;
  spec: PrintSpec | null;
}): PrintCount[] {
  if (!input.paper) return [];
  const bleed = bleedOf(input.spec, input.product);
  const setupSheets = setupSheetsOf(input.product);
  const grow = (value?: number | null) =>
    isNumber(value) && value > 0 ? value + 2 * bleed.mm : null;
  const piece = {
    width: grow(input.piece.width),
    height: grow(input.piece.height),
  };
  const impressions = Math.max(0, input.pieces || 0);
  const count = sheetCountOf(piece, input.paper, impressions);
  const counted = (count.piecesPerSheet ?? 0) > 0 && count.sheets !== null;
  return [
    {
      ...count,
      label: null,
      impressions,
      bleedMm: bleed.mm,
      bleedSource: bleed.source,
      setupSheets: counted ? setupSheets : 0,
      totalSheets: counted ? count.sheets! + setupSheets : null,
    },
  ];
}

/** O item do orçamento e da O.S. como a contagem lê. */
export type PrintCountItem = {
  quantity?: number | null;
  items?:
    | {
        width?: number | null;
        height?: number | null;
        quantity?: number | null;
      }[]
    | null;
  variation?: { paper?: SheetCountPaper | null } | null;
  product?: Partial<PrintProduct> | null;
  printSpec?: unknown;
};

/** As contagens do item gravado: a linha dá a medida e as peças. */
export function itemPrintCounts(item: PrintCountItem): PrintCount[] {
  const line = item.items?.[0];
  const product = item.product;
  return printCounts({
    piece: { width: line?.width ?? null, height: line?.height ?? null },
    pieces: line?.quantity || item.quantity || 1,
    paper: item.variation?.paper ?? null,
    product: product && 'bleedMm' in product ? (product as PrintProduct) : null,
    spec: (item.printSpec as PrintSpec | null) ?? null,
  });
}
