import {
  MigratedLine,
  decideQuantity,
} from './normalize-imported-line-quantity';

/**
 * Linhas tiradas da Clapp e da Terabyte: a carga gravava a quantidade na
 * linha, e o modal de edição do produto de uma composição só lê a da
 * composição.
 */
describe('decideQuantity', () => {
  // 110 cartões de visita a R$ 1,20: R$ 132,00.
  const linha = (over: Partial<MigratedLine> = {}): MigratedLine => ({
    lineId: 'linha-1',
    itemId: 'item-1',
    lineQuantity: 110,
    quantity: 1,
    unitKind: 'UNITY',
    unitCost: 120,
    salePrice: 13200,
    totalValue: 13200,
    width: null,
    height: null,
    ...over,
  });

  it('move para a composição a quantidade que a carga pôs na linha', () => {
    expect(decideQuantity(linha())).toEqual({ action: 'move', quantity: 110 });
  });

  it('move também a linha de produto por m², sem mexer na taxa', () => {
    // 3 peças de 1,00 × 2,00 m a R$ 60,00/m² = R$ 360,00.
    const decisao = decideQuantity(
      linha({
        lineQuantity: 3,
        unitKind: 'AREA',
        unitCost: 36000 / (1000 * 2000 * 3),
        salePrice: 36000,
        totalValue: 36000,
        width: 1000,
        height: 2000,
      }),
    );

    expect(decisao).toEqual({ action: 'move', quantity: 3 });
  });

  it('trata a linha de O.S. sem unidade como unidade avulsa, como a tela', () => {
    expect(decideQuantity(linha({ unitKind: null }))).toEqual({
      action: 'move',
      quantity: 110,
    });
  });

  it('não mexe na linha que já está no formato da tela', () => {
    expect(decideQuantity(linha({ lineQuantity: 1, quantity: 110 }))).toEqual({
      action: 'ok',
    });
  });

  it('mantém a linha que alguém salvou depois da carga', () => {
    // A O.S. 226611 da Clapp: quantidade trocada para 10 e total de R$ 12,00.
    expect(
      decideQuantity(
        linha({ quantity: 10, salePrice: 1200, totalValue: 1200 }),
      ),
    ).toEqual({ action: 'skip', reason: 'composicao' });
    expect(decideQuantity(linha({ unitCost: 100 }))).toEqual({
      action: 'skip',
      reason: 'alterada',
    });
    expect(decideQuantity(linha({ totalValue: 13000 }))).toEqual({
      action: 'skip',
      reason: 'alterada',
    });
  });

  it('mantém a linha sem medida que o modal não calcula', () => {
    // Pulseira vendida de 100 em 100 por um produto "M" do legado, sem
    // comprimento: a carga caiu na taxa igual ao total.
    expect(
      decideQuantity(
        linha({ lineQuantity: 100, unitKind: 'LENGTH', unitCost: 9000 }),
      ),
    ).toEqual({ action: 'skip', reason: 'sem-medida' });
    expect(
      decideQuantity(linha({ unitKind: 'AREA', width: null, height: 2000 })),
    ).toEqual({ action: 'skip', reason: 'sem-medida' });
  });
});
