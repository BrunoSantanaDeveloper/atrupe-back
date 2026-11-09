import type { UnitKind } from '@prisma/client';

/**
 * Unidades cujo preço total depende de uma medida (área, comprimento, peso…).
 * Para elas o `unitCost` é uma taxa por unidade bruta (R$/mm², R$/segundo…) e
 * só vira total quando multiplicado pela medida.
 */
export const DIMENSIONAL_UNIT_KINDS: UnitKind[] = [
  'AREA',
  'LENGTH',
  'CAPACITY',
  'WEIGHT',
  'DISTANCE',
  'DURATION',
];

/**
 * Códigos de unidade que a importação reconhece. Inclui os do sistema legado,
 * que cobra em UN, M2, M, KG, LT, HH e KM (tabela `ven_servico_un_com`).
 */
const UNIT_KIND_BY_CODE: Record<string, UnitKind> = {
  M2: 'AREA',
  'M²': 'AREA',
  MT2: 'AREA',
  'METRO QUADRADO': 'AREA',
  M: 'LENGTH',
  ML: 'LENGTH',
  METRO: 'LENGTH',
  'METRO LINEAR': 'LENGTH',
  KG: 'WEIGHT',
  QUILO: 'WEIGHT',
  KILO: 'WEIGHT',
  QUILOGRAMA: 'WEIGHT',
  L: 'CAPACITY',
  LT: 'CAPACITY',
  LITRO: 'CAPACITY',
  LITROS: 'CAPACITY',
  KM: 'DISTANCE',
  QUILOMETRO: 'DISTANCE',
  H: 'DURATION',
  HR: 'DURATION',
  // A hora do legado. Sem ela, o serviço cobrado por hora entrava como unidade.
  HH: 'DURATION',
  HORA: 'DURATION',
  HORAS: 'DURATION',
};

/**
 * Tipo da unidade pelo código.
 *
 * Código vazio não diz nada e devolve nulo. Código que não é de medida (UN,
 * PC, PECA…) é unidade avulsa.
 */
export function unitKindFromCode(
  code: string | null | undefined,
): UnitKind | null {
  const normalized = (code ?? '').toUpperCase().trim();
  if (!normalized) return null;
  return UNIT_KIND_BY_CODE[normalized] ?? 'UNITY';
}

/** Quantas unidades brutas cabem numa unidade de exibição. */
const RAW_PER_DISPLAY_UNIT: Partial<Record<UnitKind, number>> = {
  AREA: 1_000_000, // m² → mm²
  LENGTH: 1_000, // metro → mm
  CAPACITY: 1_000, // litro → ml
  WEIGHT: 1_000_000, // kg → mg
  DISTANCE: 1_000, // km → metro
  DURATION: 3_600, // hora → segundo
};

/**
 * Converte o valor por unidade de exibição (R$/m²) para a taxa por unidade
 * bruta que o banco guarda (R$/mm²). A tela faz a conversão inversa.
 */
export function displayToRawUnitCost(
  valueInCents: number | null,
  kind: UnitKind | null,
): number | null {
  if (valueInCents === null || valueInCents === 0) return valueInCents;
  const divisor = kind ? RAW_PER_DISPLAY_UNIT[kind] : undefined;
  return divisor ? valueInCents / divisor : valueInCents;
}

export interface ImportedItemMeasures {
  widthMm?: number | null;
  heightMm?: number | null;
  durationSeconds?: number | null;
}

/**
 * Custo e preço que a importação grava no item de um produto.
 *
 * `salePrice` é o total do item. Unidade avulsa tem o valor unitário como
 * total. Unidade com medida só tem total quando a medida vem junto: sem ela,
 * gravar a taxa por unidade bruta num campo de total faria a listagem exibir
 * 0,00, então fica nulo e o total sai no orçamento, quando a medida é
 * informada.
 */
export function importedItemPrices(
  displayUnitCostCents: number | null,
  kind: UnitKind | null,
  measures: ImportedItemMeasures = {},
): { unitCost: number | null; salePrice: number | null } {
  const unitCost = displayToRawUnitCost(displayUnitCostCents, kind);
  let salePrice: number | null = null;

  if (unitCost && unitCost > 0) {
    if (kind === 'AREA' && measures.widthMm && measures.heightMm) {
      salePrice = unitCost * measures.widthMm * measures.heightMm;
    } else if (kind === 'DURATION' && measures.durationSeconds) {
      salePrice = unitCost * measures.durationSeconds;
    } else if (!kind || !DIMENSIONAL_UNIT_KINDS.includes(kind)) {
      salePrice = unitCost;
    }
  }

  return { unitCost, salePrice };
}

/**
 * Onde fica a quantidade de uma linha de documento migrado.
 *
 * A tela grava o produto de uma composição com a linha em 1 e a quantidade na
 * composição, e o modal de edição desse produto lê só a da composição. A carga
 * gravava o contrário (linha = N, composição = 1): o modal mostrava
 * "Quantidade 1" e, ao salvar, gravava o total dividido por N. Produto
 * composto leva a quantidade na linha, como a tela também faz.
 *
 * A taxa da linha não muda: a medida total é a quantidade vezes a medida, em
 * qualquer dos dois lugares.
 */
export function lineQuantities(
  quantity: number,
  compositions: number,
): { line: number; composition: number } {
  if (compositions === 1 && quantity >= 1) {
    return { line: 1, composition: quantity };
  }
  return { line: quantity, composition: 1 };
}

/** Medidas de uma linha de documento, em unidade bruta (mm, segundos). */
export interface LineDimensions {
  width?: number | null;
  height?: number | null;
  length?: number | null;
  duration?: number | null;
}

/**
 * Medida bruta que multiplica o preço unitário da linha.
 *
 * A tela recalcula `unitCost = salePrice / medida` ao abrir o item. Se o
 * `unitCost` gravado não seguir a mesma regra, abrir a linha sobrescreve o
 * valor da venda pelo do catálogo — foi o que aconteceu na primeira carga.
 */
export function lineRawMeasure(
  unitKind: UnitKind | null,
  item: LineDimensions,
  quantity: number,
): number {
  switch (unitKind) {
    case 'AREA':
      return (item.width || 0) * (item.height || 0);
    case 'LENGTH':
      return item.width || item.length || 0;
    case 'DURATION':
      return item.duration || 0;
    default:
      // Unidade avulsa não tem medida própria: a quantidade da linha é
      // aplicada pelo chamador.
      return quantity;
  }
}

/**
 * Taxa por unidade bruta coerente com o valor da linha, para a tela não
 * recalcular um valor diferente do que foi vendido.
 *
 * A tela obtém a medida total multiplicando a medida unitária pela quantidade
 * da linha; a taxa precisa sair da mesma base.
 */
export function lineUnitCost(
  lineTotalInCents: number | null,
  unitKind: UnitKind | null,
  dimensions: LineDimensions,
  quantity: number,
): number | null {
  if (lineTotalInCents === null) return null;

  const measure = lineRawMeasure(unitKind, dimensions, 1) * (quantity || 1);
  return measure > 0 ? lineTotalInCents / measure : lineTotalInCents;
}
