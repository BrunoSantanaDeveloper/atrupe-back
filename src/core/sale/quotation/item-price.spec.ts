import { priceMultiRowItem, priceSimpleItem } from './item-price';

describe('priceSimpleItem: a conta do formulário do item no servidor', () => {
  // R$ 100,00 o m² = 10.000 centavos por 1.000.000 mm²
  const perMm2 = 10_000 / 1_000_000;

  it('item em m²: preço do m² × a área × a quantidade', () => {
    const price = priceSimpleItem({
      unitKind: 'AREA',
      catalogUnitCost: perMm2,
      measure: { width: 300, height: 400 },
      quantity: 200,
    });

    // 0,12 m² × 200 = 24 m² × R$ 100 = R$ 2.400,00
    expect(price).toEqual(
      expect.objectContaining({
        unitPrice: 10_000,
        soldQuantity: 24,
        chargedQuantity: 24,
        total: 240_000,
        rules: [],
      }),
    );
  });

  it('abaixo da quantidade mínima (0,5 m²): cobra o mínimo, igual à tela', () => {
    const price = priceSimpleItem({
      unitKind: 'AREA',
      catalogUnitCost: perMm2,
      measure: { width: 300, height: 300 },
      quantity: 1,
      minQuantity: 0.5,
    });

    expect(price.soldQuantity).toBeCloseTo(0.09);
    expect(price.chargedQuantity).toBe(0.5);
    expect(price.total).toBe(5_000);
    expect(price.rules).toEqual(['quantidade mínima de 0,5 m²']);
  });

  it('venda mínima por item: o maior entre a conta e o mínimo', () => {
    const price = priceSimpleItem({
      unitKind: 'AREA',
      catalogUnitCost: perMm2,
      measure: { width: 300, height: 300 },
      quantity: 1,
      minItemValue: 1_500,
    });

    // 0,09 m² × R$ 100 = R$ 9,00, abaixo dos R$ 15,00
    expect(price.total).toBe(1_500);
    // O "R$" do toLocaleString vem com espaço sem quebra
    expect(price.rules.map((rule) => rule.replace(/\s/g, ' '))).toEqual([
      'venda mínima de R$ 15,00',
    ]);
  });

  it('venda mínima acima da conta não muda o preço e diz que não se aplica', () => {
    const price = priceSimpleItem({
      unitKind: 'UNITY',
      catalogUnitCost: 5_000,
      measure: {},
      quantity: 3,
      minItemValue: 1_500,
    });

    expect(price.total).toBe(15_000);
    expect(price.rules).toEqual(['venda mínima não se aplica']);
  });

  it('faixa de quantidade: o preço da maior faixa alcançada', () => {
    const price = priceSimpleItem({
      unitKind: 'UNITY',
      catalogUnitCost: 120,
      measure: {},
      quantity: 150,
      tiers: [
        { from: 1, unitPrice: 120 },
        { from: 100, unitPrice: 90 },
        { from: 500, unitPrice: 70 },
      ],
    });

    expect(price.unitPrice).toBe(90);
    expect(price.total).toBe(13_500);
    expect(price.rules).toEqual(['faixa 100+']);
  });

  it('variação com preço vale no lugar do produto e as faixas não se aplicam', () => {
    const price = priceSimpleItem({
      unitKind: 'UNITY',
      catalogUnitCost: 2_000,
      measure: {},
      quantity: 10,
      variation: { name: 'G', unitPrice: 2_500 },
      tiers: [{ from: 1, unitPrice: 1_000 }],
    });

    expect(price.total).toBe(25_000);
    expect(price.rules).toEqual(['variação G']);
  });

  it('variação sem preço usa o preço do produto', () => {
    const price = priceSimpleItem({
      unitKind: 'UNITY',
      catalogUnitCost: 2_000,
      measure: {},
      quantity: 2,
      variation: { name: 'Azul', unitPrice: null },
    });

    expect(price.total).toBe(4_000);
  });

  it('sem preço no cadastro: nulo', () => {
    expect(
      priceSimpleItem({
        unitKind: 'UNITY',
        catalogUnitCost: null,
        measure: {},
        quantity: 1,
      }),
    ).toBeNull();
  });
});

describe('priceMultiRowItem', () => {
  it('cada linha na medida do cadastro × a quantidade do item', () => {
    expect(
      priceMultiRowItem(
        [
          { unitKind: 'UNITY', unitCost: 1_000, quantity: 1 },
          {
            unitKind: 'AREA',
            unitCost: 0.01,
            width: 1000,
            height: 500,
            quantity: 1,
          },
        ],
        3,
      ),
    ).toBe(3_000 + 15_000);
  });
});
