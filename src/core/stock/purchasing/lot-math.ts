/**
 * As contas do lote (ES-8 a ES-12), puras. O lote guarda a quantidade na
 * unidade do material e, no rolo e na chapa, as medidas (largura e
 * comprimento, em metros). O saldo atual é a sobra: a quantidade acompanha
 * a área que restou, na proporção da área de entrada.
 */

export type LotMeasure = 'ROLL' | 'SHEET' | 'UNIT';

export type LotShape = {
  measure: LotMeasure;
  quantity: number;
  width: number | null;
  length: number | null;
  currentQuantity: number;
  currentWidth: number | null;
  currentLength: number | null;
  /** Centavos, do lote inteiro */
  cost: number;
};

const round = (value: number, places = 4) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const hasArea = (lot: Pick<LotShape, 'measure' | 'width' | 'length'>) =>
  lot.measure !== 'UNIT' && !!lot.width && !!lot.length;

/** A quantidade que corresponde à área (largura × comprimento). */
export const quantityOfArea = (
  lot: Pick<LotShape, 'quantity' | 'width' | 'length'>,
  width: number,
  length: number,
) => round((lot.quantity * width * length) / (lot.width! * lot.length!));

/** O custo por unidade do material, em centavos. */
export const unitCostOf = (lot: Pick<LotShape, 'cost' | 'quantity'>) =>
  lot.quantity > 0 ? Math.round(lot.cost / lot.quantity) : 0;

export type LotUse =
  /** Rolo: quantos metros saíram, na largura atual */
  | { length: number }
  /** O que sobrou, medido (o retalho): a largura e o comprimento atuais */
  | { width: number; length: number; remaining: true }
  /** Por quantidade */
  | { quantity: number };

/**
 * A baixa no lote: devolve o saldo novo e quanto saiu (na unidade do
 * material). Não deixa sair mais do que há.
 */
export function useLot(lot: LotShape, use: LotUse) {
  if ('quantity' in use) {
    if (!(use.quantity > 0)) throw new Error('Informe quanto saiu');
    if (use.quantity > lot.currentQuantity + 1e-9) {
      throw new Error('Saiu mais do que o lote tem');
    }
    const currentQuantity = round(lot.currentQuantity - use.quantity);
    // A medida acompanha a quantidade, quando há área
    const ratio = lot.currentQuantity
      ? currentQuantity / lot.currentQuantity
      : 0;
    return {
      used: round(use.quantity),
      currentQuantity,
      currentWidth: lot.currentWidth,
      currentLength:
        hasArea(lot) && lot.currentLength !== null
          ? round(lot.currentLength * ratio)
          : lot.currentLength,
    };
  }
  if (!hasArea(lot)) throw new Error('O lote não tem medidas');
  const width = lot.currentWidth ?? lot.width!;
  const length = lot.currentLength ?? lot.length!;
  let nextWidth = width;
  let nextLength = length;
  if ('remaining' in use) {
    // A sobra 0 × 0 zeraria o lote: encerrar sem sobra é o Finalizar
    if (!(use.width > 0) || !(use.length > 0)) {
      throw new Error(
        'Informe a largura e o comprimento da sobra, maiores que zero (para encerrar o lote sem sobra, use Finalizar lote)',
      );
    }
    if (use.width > width + 1e-9 || use.length > length + 1e-9) {
      throw new Error('A sobra não pode ser maior que o lote');
    }
    nextWidth = use.width;
    nextLength = use.length;
  } else {
    if (!(use.length > 0)) throw new Error('Informe quantos metros saíram');
    if (use.length > length + 1e-9) {
      throw new Error('Saiu mais do que o lote tem');
    }
    nextLength = length - use.length;
  }
  const currentQuantity = quantityOfArea(lot, nextWidth, nextLength);
  return {
    used: round(lot.currentQuantity - currentQuantity),
    currentQuantity,
    currentWidth: round(nextWidth),
    currentLength: round(nextLength),
  };
}

export type LotCut =
  /** Corta um pedaço do comprimento, na largura atual */
  | { length: number }
  /** Corta uma faixa da largura, no comprimento atual */
  | { width: number }
  /** Separa uma quantidade */
  | { quantity: number };

/**
 * Dividir o lote (ES-10): o pedaço vira um lote novo, com a parte do custo
 * na proporção, e o lote de origem fica com o resto.
 */
export function splitLot(lot: LotShape, cut: LotCut) {
  if ('quantity' in cut) {
    if (!(cut.quantity > 0) || cut.quantity >= lot.currentQuantity) {
      throw new Error('O pedaço precisa ser menor que o lote');
    }
    const share = cut.quantity / lot.quantity;
    const currentQuantity = round(lot.currentQuantity - cut.quantity);
    // No rolo e na chapa, o pedaço sai do comprimento, na largura atual (como
    // a baixa por quantidade): o resto encolhe na mesma razão
    const length = hasArea(lot) ? lot.currentLength : null;
    const width = lot.currentWidth ?? lot.width;
    const restLength =
      length !== null
        ? round((length * currentQuantity) / lot.currentQuantity)
        : null;
    return {
      piece: {
        quantity: round(cut.quantity),
        width: length !== null ? width : null,
        length: length !== null ? round(length - restLength!) : null,
        cost: Math.round(lot.cost * share),
      },
      rest: {
        currentQuantity,
        currentWidth: lot.currentWidth,
        currentLength: length !== null ? restLength : lot.currentLength,
      },
    };
  }
  if (!hasArea(lot)) throw new Error('O lote não tem medidas');
  const width = lot.currentWidth ?? lot.width!;
  const length = lot.currentLength ?? lot.length!;
  const piece =
    'length' in cut
      ? { width, length: cut.length }
      : { width: cut.width, length };
  const rest =
    'length' in cut
      ? { width, length: length - cut.length }
      : { width: width - cut.width, length };
  if (
    !(piece.width > 0 && piece.length > 0) ||
    rest.width <= 0 ||
    rest.length <= 0
  ) {
    throw new Error('O pedaço precisa ser menor que o lote');
  }
  const pieceQuantity = quantityOfArea(lot, piece.width, piece.length);
  return {
    piece: {
      quantity: pieceQuantity,
      width: round(piece.width),
      length: round(piece.length),
      cost: Math.round((lot.cost * pieceQuantity) / lot.quantity),
    },
    rest: {
      currentQuantity: quantityOfArea(lot, rest.width, rest.length),
      currentWidth: round(rest.width),
      currentLength: round(rest.length),
    },
  };
}

/**
 * As parcelas da compra (ES-15): o total dividido, o resto do arredondamento
 * na primeira; a primeira na data informada e as outras de tantos em tantos
 * dias. Cada parcela tem pelo menos um centavo.
 */
export function installmentsOf(
  total: number,
  count: number,
  firstDue: string,
  everyDays = 30,
) {
  const n = Math.max(1, Math.min(Math.round(count), 48));
  if (n > total) {
    throw new Error(
      `O valor não dá ${n} parcelas: cada parcela precisa de pelo menos um centavo`,
    );
  }
  const base = Math.floor(total / n);
  const start = new Date(`${firstDue}T12:00:00.000Z`);
  return Array.from({ length: n }, (_, index) => {
    const due = new Date(start);
    due.setUTCDate(due.getUTCDate() + index * everyDays);
    return {
      number: index + 1,
      amount: index === 0 ? total - base * (n - 1) : base,
      dueDate: due.toISOString().slice(0, 10),
    };
  });
}
