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

/**
 * "Unidade comercial" cadastrada no fiscal do produto, no formato de uCom:
 * maiúsculas ASCII, até 6 caracteres. "m²" vira "M2". Vazio sem cadastro.
 */
export function normalizeUnitCode(unit?: string | null): string {
  const text = (unit || '').split('²').join('2').split('³').join('3');
  let ascii = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code > 32 && code < 127) ascii += char;
  }
  return ascii.toUpperCase().slice(0, 6);
}

/**
 * Grandeza de uma unidade comercial. O que não é unidade de medida conhecida
 * (UN, PC, CX, KIT…) é contado em peças.
 */
export function kindFromUnitCode(unit?: string | null): string {
  switch (normalizeUnitCode(unit)) {
    case 'M2':
    case 'MT2':
      return 'AREA';
    case 'M':
    case 'MT':
    case 'ML':
      return 'LENGTH';
    case 'L':
    case 'LT':
      return 'CAPACITY';
    case 'KG':
      return 'WEIGHT';
    case 'KM':
      return 'DISTANCE';
    case 'H':
    case 'HR':
    case 'HH':
    case 'HORA':
      return 'DURATION';
    // Medidas que a composição não guarda nessa escala (m³, cm, g…): não há
    // conversão, e usá-las como rótulo de peça faria 4 peças saírem "4 M3".
    case 'M3':
    case 'CM':
    case 'CM2':
    case 'MM':
    case 'G':
    case 'MG':
    case 'TON':
      return 'OTHER';
    default:
      return 'UNITY';
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
 *
 * `registeredUnit` é a "Unidade comercial" do fiscal do produto, e a nota a
 * segue (decisão de 15/11/2026): a medida só vira quantidade quando o cadastro
 * diz a unidade dela (M2 para área). Com UN, a placa de 2,50 × 1,00 m sai
 * "1 UN × R$ 530", como o cliente vendeu e como o legado emitia — e não
 * "2,5 M2 × R$ 212", que a GrafK e as contas migradas liam como valor errado.
 * Sem o argumento vale a regra anterior, que o relatório de vendidos usa.
 */
export function resolveCommercialQuantity(
  itemQuantity: number | null | undefined,
  compositions: QuotationComposition[] | null | undefined,
  registeredUnit?: string | null,
): CommercialQuantity {
  const baseQuantity = itemQuantity || 1;
  const items = compositions || [];

  const followsRegistered = registeredUnit !== undefined;
  const registered = normalizeUnitCode(registeredUnit);
  const registeredKind = kindFromUnitCode(registered);
  // Peça leva a unidade cadastrada quando ela é de peça (UN, PC, CX…).
  const pieceUnit =
    followsRegistered && registered && registeredKind === 'UNITY'
      ? registered
      : 'UN';

  if (items.length !== 1) {
    return { quantity: baseQuantity, unit: pieceUnit };
  }

  const composition = items[0];
  const compositionQuantity =
    composition.quantity || composition.originalQuantity || 1;
  const kind = (composition.unitKind || '').toUpperCase();
  const pieces = {
    quantity: baseQuantity * compositionQuantity,
    unit: pieceUnit,
  };

  if (!kind || kind === 'UNITY') return pieces;
  if (followsRegistered && registeredKind !== kind) return pieces;

  const perPiece = measurePerPiece(composition);
  if (perPiece === null || perPiece <= 0) return pieces;

  return {
    quantity: perPiece * compositionQuantity * baseQuantity,
    unit: unitCodeFromKind(kind),
  };
}
