import {
  DEFAULT_BLEED_MM,
  PrintProduct,
  bleedOf,
  itemPrintCounts,
  printCounts,
  setupSheetsOf,
} from './print-count';

const A3 = {
  name: 'Couché 300 A3',
  sheetWidth: 297,
  sheetHeight: 420,
  usableWidth: null,
  usableHeight: null,
};
const A4 = {
  name: 'Sulfite 75 A4',
  sheetWidth: 210,
  sheetHeight: 297,
  usableWidth: null,
  usableHeight: null,
};

const product = (over: Partial<PrintProduct> = {}): PrintProduct => ({
  bleedMm: null,
  setupSheets: null,
  sector: null,
  ...over,
});

const card = { width: 50, height: 90 };

describe('bleedOf: a sangria em uso e de onde vem (GR-1.1)', () => {
  it('item, depois produto, depois setor, depois 2 mm', () => {
    const sector = { bleedMm: 3, setupSheets: null };
    expect(bleedOf({ bleedMm: 0 }, product({ bleedMm: 1, sector }))).toEqual({
      mm: 0,
      source: 'ITEM',
    });
    expect(bleedOf(null, product({ bleedMm: 1, sector }))).toEqual({
      mm: 1,
      source: 'PRODUCT',
    });
    expect(bleedOf(null, product({ sector }))).toEqual({
      mm: 3,
      source: 'SECTOR',
    });
    expect(bleedOf(null, null)).toEqual({
      mm: DEFAULT_BLEED_MM,
      source: 'DEFAULT',
    });
  });

  it('as folhas de acerto: do produto, senão do setor, senão nenhuma', () => {
    const sector = { bleedMm: null, setupSheets: 5 };
    expect(setupSheetsOf(product({ setupSheets: 2, sector }))).toBe(2);
    expect(setupSheetsOf(product({ sector }))).toBe(5);
    expect(setupSheetsOf(null)).toBe(0);
  });
});

describe('printCounts', () => {
  it('o exemplo da regra AP-1: cartão 5 × 9 em A3, sem sangria, 24 por folha e 42 folhas para mil', () => {
    const [count] = printCounts({
      piece: card,
      pieces: 1000,
      paper: A3,
      product: product({ bleedMm: 0 }),
      spec: null,
    });
    expect(count).toMatchObject({
      label: null,
      impressions: 1000,
      piecesPerSheet: 24,
      sheets: 42,
      setupSheets: 0,
      totalSheets: 42,
      bleedSource: 'PRODUCT',
    });
  });

  it('com a sangria padrão de 2 mm a peça ocupa 54 × 94 e cabem 21; o acerto soma', () => {
    const [count] = printCounts({
      piece: card,
      pieces: 1000,
      paper: A3,
      product: product({ sector: { bleedMm: null, setupSheets: 3 } }),
      spec: null,
    });
    expect(count).toMatchObject({
      piecesPerSheet: 21,
      sheets: 48,
      setupSheets: 3,
      totalSheets: 51,
      bleedMm: 2,
      bleedSource: 'DEFAULT',
    });
  });

  it('sem papel na variação, não conta', () => {
    expect(
      printCounts({
        piece: card,
        pieces: 10,
        paper: null,
        product: product(),
        spec: null,
      }),
    ).toEqual([]);
  });

  it('peça que não cabe: zero por folha, sem total e sem acerto', () => {
    const [count] = printCounts({
      piece: { width: 500, height: 500 },
      pieces: 10,
      paper: A4,
      product: product({ setupSheets: 3 }),
      spec: null,
    });
    expect(count).toMatchObject({
      piecesPerSheet: 0,
      totalSheets: null,
      setupSheets: 0,
    });
    expect(count.warning).toBeTruthy();
  });
});

describe('itemPrintCounts: o item gravado', () => {
  it('lê a medida e as peças da linha, o papel da variação e a sangria do item', () => {
    const [count] = itemPrintCounts({
      quantity: 1,
      items: [{ width: 50, height: 90, quantity: 1000 }],
      variation: { paper: A3 },
      product: product(),
      printSpec: { bleedMm: 0 },
    });
    expect(count).toMatchObject({ piecesPerSheet: 24, sheets: 42 });
  });

  it('o item sem os campos de impressão do produto usa os padrões', () => {
    const [count] = itemPrintCounts({
      quantity: 1,
      items: [{ width: 50, height: 90, quantity: 1000 }],
      variation: { paper: A3 },
      product: null,
    });
    expect(count).toMatchObject({ piecesPerSheet: 21, bleedMm: 2 });
  });
});
