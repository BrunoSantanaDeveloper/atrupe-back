import {
  itemProductName,
  itemValuesOf,
  materialItemName,
  soldItemOf,
} from './item-origin';

describe('item sem produto (Fase 4.4 e 4.5)', () => {
  it('o produto soma as linhas de composição, como antes', () => {
    expect(
      itemValuesOf({
        productId: 'p-1',
        quantity: 2,
        totalValue: 999,
        items: [
          { unitCost: 100, totalValue: 400, productItem: { salePrice: 200 } },
          { unitCost: 50, totalValue: 100, salePrice: 50 },
        ],
      }),
    ).toEqual({ unitValue: 150, totalValue: 500, originalValue: 250 });
  });

  it('o material tem o valor no item e o preço por unidade da venda', () => {
    expect(
      itemValuesOf({
        productId: null,
        quantity: 4,
        totalValue: 1000,
        unitPrice: 250,
        items: [],
      }),
    ).toEqual({ unitValue: 250, totalValue: 1000, originalValue: 250 });
  });

  it('o item montado, sem preço por unidade, divide o valor pela quantidade', () => {
    expect(
      itemValuesOf({
        productId: null,
        quantity: 3,
        totalValue: 900,
        items: [],
      }),
    ).toEqual({ unitValue: 300, totalValue: 900, originalValue: 300 });
  });

  it('nome do material com a variação; sem produto, o nome vem do material ou da descrição', () => {
    expect(
      materialItemName({ name: 'Lona 440' }, { brand: 'Marca X', color: '' }),
    ).toBe('Lona 440 · Marca X');
    expect(materialItemName({ name: 'Lona 440' }, null)).toBe('Lona 440');
    expect(
      itemProductName({
        product: null,
        material: { name: 'Lona 440' },
        materialVariation: { brand: 'X', color: 'Azul' },
      }),
    ).toBe('Lona 440 · X Azul');
    expect(itemProductName({ product: null, description: 'Placa' })).toBe(
      'Placa',
    );
    expect(
      itemProductName({ product: { name: 'Banner' }, description: 'Outro' }),
    ).toBe('Banner');
  });

  it('nos relatórios, cada tipo tem a própria chave', () => {
    expect(
      soldItemOf({ productId: 'p-1', product: { name: 'Banner' } }),
    ).toEqual({ key: 'p:p-1', name: 'Banner', type: 'Produto' });
    expect(
      soldItemOf({
        productId: null,
        materialId: 'm-1',
        materialVariationId: null,
        material: { name: 'Lona' },
      }),
    ).toEqual({ key: 'm:m-1:', name: 'Lona', type: 'Material' });
    expect(soldItemOf({ productId: null, description: ' Placa ' })).toEqual({
      key: 'c:placa',
      name: 'Placa',
      type: 'Item montado',
    });
  });
});
