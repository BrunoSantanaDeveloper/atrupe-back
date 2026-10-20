import {
  PAPER_WITHOUT_SHEET,
  PIECE_DOES_NOT_FIT,
  PIECE_WITHOUT_MEASURE,
  itemSheetCount,
  sheetCountOf,
} from './sheet-count';

/**
 * A contagem de folhas (Papéis no LITE, 13/10/2026): peças por folha na
 * melhor das duas orientações, na área útil (vazia = a folha inteira), e
 * folhas = ceil(quantidade ÷ peças por folha). Sem custo.
 */
const sra3 = {
  name: 'Couché 300 g',
  sheetWidth: 320,
  sheetHeight: 450,
  usableWidth: 310,
  usableHeight: 440,
};
const a4 = {
  name: 'Sulfite 75 g',
  sheetWidth: 210,
  sheetHeight: 297,
  usableWidth: null,
  usableHeight: null,
};

describe('contagem de folhas', () => {
  it('cartão 90 × 50 no SRA3 com área útil: 24 por folha, 1000 cartões em 42 folhas', () => {
    expect(sheetCountOf({ width: 90, height: 50 }, sra3, 1000)).toEqual({
      paperName: 'Couché 300 g',
      piecesPerSheet: 24,
      sheets: 42,
      warning: null,
    });
  });

  it('vale a orientação que cabe mais', () => {
    // Em pé: 1 × 4 = 4; deitada: 3 × 2 = 6
    expect(sheetCountOf({ width: 140, height: 60 }, a4, 10)).toMatchObject({
      piecesPerSheet: 6,
      sheets: 2,
    });
    // A mesma peça girada dá o mesmo
    expect(sheetCountOf({ width: 60, height: 140 }, a4, 10)).toMatchObject({
      piecesPerSheet: 6,
      sheets: 2,
    });
  });

  it('sem área útil, vale a folha inteira', () => {
    // 210 × 297: 2 × 2 peças de 105 × 148,5
    expect(sheetCountOf({ width: 105, height: 148.5 }, a4, 4)).toMatchObject({
      piecesPerSheet: 4,
      sheets: 1,
    });
    // Com a área útil menor, cabem 2 (deitadas), não 4
    expect(
      sheetCountOf(
        { width: 105, height: 148.5 },
        { ...a4, usableWidth: 200, usableHeight: 287 },
        4,
      ),
    ).toMatchObject({ piecesPerSheet: 2, sheets: 2 });
  });

  it('a peça maior que a área útil não cabe: 0 por folha e o aviso', () => {
    // 315 × 100 ainda cabe deitada (3 por folha); 450 × 100 não cabe
    expect(sheetCountOf({ width: 315, height: 100 }, sra3, 10)).toMatchObject({
      piecesPerSheet: 3,
      warning: null,
    });
    expect(sheetCountOf({ width: 450, height: 100 }, sra3, 10)).toEqual({
      paperName: 'Couché 300 g',
      piecesPerSheet: 0,
      sheets: 0,
      warning: PIECE_DOES_NOT_FIT,
    });
    expect(PIECE_DOES_NOT_FIT).toBe('A peça não cabe na área útil do papel');
  });

  it('a peça do tamanho exato da área útil cabe uma vez', () => {
    expect(sheetCountOf({ width: 440, height: 310 }, sra3, 3)).toMatchObject({
      piecesPerSheet: 1,
      sheets: 3,
    });
  });

  it('sem a medida da peça, ou sem a folha, não há contagem', () => {
    expect(sheetCountOf({ width: 90, height: null }, sra3, 10)).toEqual({
      paperName: 'Couché 300 g',
      piecesPerSheet: null,
      sheets: null,
      warning: PIECE_WITHOUT_MEASURE,
    });
    expect(
      sheetCountOf(
        { width: 90, height: 50 },
        { ...a4, sheetWidth: null, sheetHeight: null },
        10,
      ),
    ).toMatchObject({ piecesPerSheet: null, warning: PAPER_WITHOUT_SHEET });
  });

  it('o item lê a medida e a quantidade da linha, e o papel da variação', () => {
    expect(
      itemSheetCount({
        quantity: 2,
        items: [{ width: 90, height: 50, quantity: 1000 }],
        variation: { paper: sra3 },
      }),
    ).toEqual({
      paperName: 'Couché 300 g',
      piecesPerSheet: 24,
      sheets: 42,
      warning: null,
    });
    // Sem a quantidade da linha, vale a do item
    expect(
      itemSheetCount({
        quantity: 30,
        items: [{ width: 90, height: 50 }],
        variation: { paper: sra3 },
      }),
    ).toMatchObject({ sheets: 2 });
    // Sem papel na variação, nada
    expect(
      itemSheetCount({ quantity: 1, items: [], variation: { paper: null } }),
    ).toBeNull();
    expect(itemSheetCount({ quantity: 1, items: [] })).toBeNull();
  });
});
