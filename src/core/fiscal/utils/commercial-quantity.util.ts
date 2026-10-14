/**
 * Quantidade e unidade COMERCIAIS de um item de orçamento, para a NF-e.
 *
 * Contraparte de `calculateTotalQuantity` em
 * `app-web/src/lib/quotation-display-utils.ts`. Os dois repositórios são
 * separados e não há pacote compartilhado, então a fórmula vive duas vezes de
 * propósito: a quantidade de um documento fiscal não pode chegar pelo cliente.
 * Ao mexer em uma, conferir a outra — os testes usam os mesmos casos da tela.
 *
 * As medidas ficam no banco em unidades pequenas: dimensões em MILÍMETROS,
 * peso em MILIGRAMAS, volume em MILILITROS, distância em METROS, duração em
 * SEGUNDOS. A NF-e recebe a unidade usual (m², m, kg, L, km, h).
 */

/** Composição (QuotationProductItem) na forma em que o Prisma devolve. */
export interface QuotationComposition {
  quantity?: number | null;
  originalQuantity?: number | null;
  unitKind?: string | null;
  width?: number | null;
  height?: number | null;
  length?: number | null;
  volume?: number | null;
  weight?: number | null;
  distance?: number | null;
  duration?: number | null;
}

export interface CommercialQuantity {
  quantity: number;
  /** uCom da NF-e: ASCII maiúsculo, no máximo 6 caracteres. */
  unit: string;
}

/**
 * uCom é texto livre no leiaute e a SEFAZ não confere contra tabela, mas o
 * campo tem 6 caracteres e não aceita bem não-ASCII — por isso `M2` e não `m²`.
 */
export function unitCodeFromKind(unitKind?: string | null): string {
  switch ((unitKind || '').toUpperCase()) {
    case 'AREA':
      return 'M2';
    case 'LENGTH':
      return 'M';
    case 'CAPACITY':
      return 'L';
    case 'WEIGHT':
      return 'KG';
    case 'DISTANCE':
      return 'KM';
    case 'DURATION':
      return 'H';
    case 'UNITY':
    default:
      return 'UN';
  }
}

/** Medida de UMA peça, na unidade usual. `null` quando falta dimensão. */
function measurePerPiece(composition: QuotationComposition): number | null {
  switch ((composition.unitKind || '').toUpperCase()) {
    case 'AREA':
      return composition.width && composition.height
        ? (composition.width / 1000) * (composition.height / 1000)
        : null;
    case 'LENGTH':
      return composition.length ? composition.length / 1000 : null;
    case 'CAPACITY':
      return composition.volume ? composition.volume / 1000 : null;
    case 'WEIGHT':
      return composition.weight ? composition.weight / 1_000_000 : null;
    case 'DISTANCE':
      return composition.distance ? composition.distance / 1000 : null;
    case 'DURATION':
      return composition.duration ? composition.duration / 3600 : null;
    default:
      return null;
  }
}

/**
 * Resolve o par (quantidade, unidade) que vai para `qCOM`/`uCOM`.
 *
 * A regra é: **a quantidade da nota é a quantidade da coisa vendida.**
 *
 * - Produto simples (uma composição) — a coisa vendida é a medida da
 *   composição: 14 peças de 1m x 1m viram `14 M2`.
 * - Produto composto (mais de uma composição) — a coisa vendida é a unidade
 *   montada: 3 banners são `3 UN`, não a soma das partes. Composição é conceito
 *   de produção, e somar tipos diferentes (m² com kg) não significaria nada.
 * - Sem composição carregada — cai em `UN` com a quantidade do item. É também a
 *   rede de segurança para quando o `include` não trouxer a relação.
 *
 * Divergência DELIBERADA da tela: quando falta a dimensão que o tipo exige (um
 * item AREA sem largura), a tela mostra 0 e aqui cai em `UN`. Emitir `qCOM = 0`
 * seria rejeitado pela SEFAZ, e uma nota errada é pior que um número feio.
 */
/**
 * A unidade comercial do material de venda direta (ORG-1): o item dele não
 * tem composição, e a quantidade já está na unidade do material.
 */
export function materialUnitCode(unit?: string | null): string | null {
  switch ((unit || '').toUpperCase()) {
    case 'M2':
      return 'M2';
    case 'M':
      return 'M';
    case 'KM':
      return 'KM';
    case 'KG':
      return 'KG';
    case 'LT':
      return 'L';
    case 'HR':
      return 'H';
    case 'UN':
      return 'UN';
    default:
      return null;
  }
}

export function resolveCommercialQuantity(
  itemQuantity: number | null | undefined,
  compositions: QuotationComposition[] | null | undefined,
  /** A unidade do item sem composição (o material de venda direta) */
  ownUnit?: string | null,
): CommercialQuantity {
  const baseQuantity = itemQuantity || 1;
  const items = compositions || [];

  if (items.length !== 1) {
    return { quantity: baseQuantity, unit: (!items.length && ownUnit) || 'UN' };
  }

  const composition = items[0];
  const compositionQuantity =
    composition.quantity || composition.originalQuantity || 1;
  const kind = (composition.unitKind || '').toUpperCase();

  if (!kind || kind === 'UNITY') {
    return { quantity: baseQuantity * compositionQuantity, unit: 'UN' };
  }

  const perPiece = measurePerPiece(composition);
  if (perPiece === null || perPiece <= 0) {
    return { quantity: baseQuantity * compositionQuantity, unit: 'UN' };
  }

  return {
    quantity: perPiece * compositionQuantity * baseQuantity,
    unit: unitCodeFromKind(kind),
  };
}
