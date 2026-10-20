import { ceilCount, fitCount } from '../assembly/engine/compute';
import { PaperRow } from './paper';

/**
 * A contagem de folhas (Papéis no LITE, PO 13/10/2026): quantas peças cabem
 * no papel e quantas folhas o pedido gasta. Sem custo: o LITE conta folhas,
 * não as cobra. Medidas em mm.
 */

export const PIECE_DOES_NOT_FIT = 'A peça não cabe na área útil do papel';
export const PIECE_WITHOUT_MEASURE =
  'Sem a medida da peça, não dá para contar as folhas';
export const PAPER_WITHOUT_SHEET = 'O papel não tem a medida da folha';

export type SheetCount = {
  paperName: string;
  /** A melhor das duas orientações; 0 quando a peça não cabe. */
  piecesPerSheet: number | null;
  /** ceil(peças ÷ peças por folha); 0 quando a peça não cabe. */
  sheets: number | null;
  warning: string | null;
};

export type SheetCountPaper = Pick<
  PaperRow,
  'name' | 'sheetWidth' | 'sheetHeight' | 'usableWidth' | 'usableHeight'
>;

const positive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && value > 0;

/**
 * Peças por folha e folhas do pedido. A peça entra em pé ou deitada (vale a
 * orientação que cabe mais, todas as peças na mesma), na área útil do papel;
 * área útil vazia é a folha inteira. Sem sangria configurável por enquanto.
 */
export function sheetCountOf(
  piece: { width?: number | null; height?: number | null },
  paper: SheetCountPaper,
  quantity: number,
): SheetCount {
  const area =
    positive(paper.usableWidth) && positive(paper.usableHeight)
      ? { width: paper.usableWidth, height: paper.usableHeight }
      : positive(paper.sheetWidth) && positive(paper.sheetHeight)
        ? { width: paper.sheetWidth, height: paper.sheetHeight }
        : null;
  const empty = (warning: string): SheetCount => ({
    paperName: paper.name,
    piecesPerSheet: null,
    sheets: null,
    warning,
  });
  if (!area) return empty(PAPER_WITHOUT_SHEET);
  if (!positive(piece.width) || !positive(piece.height)) {
    return empty(PIECE_WITHOUT_MEASURE);
  }

  const piecesPerSheet = Math.max(
    fitCount(area.width, area.height, piece.width, piece.height),
    fitCount(area.width, area.height, piece.height, piece.width),
  );
  if (!piecesPerSheet) {
    return {
      paperName: paper.name,
      piecesPerSheet: 0,
      sheets: 0,
      warning: PIECE_DOES_NOT_FIT,
    };
  }
  return {
    paperName: paper.name,
    piecesPerSheet,
    sheets: quantity > 0 ? ceilCount(quantity / piecesPerSheet) : 0,
    warning: null,
  };
}

/** O item do orçamento e da O.S. como a contagem lê. */
export type SheetCountItem = {
  quantity?: number | null;
  items?:
    | {
        width?: number | null;
        height?: number | null;
        quantity?: number | null;
      }[]
    | null;
  variation?: { paper?: SheetCountPaper | null } | null;
};

/**
 * A contagem do item do orçamento e da O.S.: nula quando a variação não tem
 * papel. A peça é a medida da linha do item (mm) e as peças são a quantidade
 * dela (o pedido vezes as peças de cada unidade), ou a do item.
 */
export function itemSheetCount(item: SheetCountItem): SheetCount | null {
  const paper = item.variation?.paper;
  if (!paper) return null;
  const line = item.items?.[0];
  const pieces = line?.quantity || item.quantity || 1;
  return sheetCountOf(
    { width: line?.width ?? null, height: line?.height ?? null },
    paper,
    pieces,
  );
}
