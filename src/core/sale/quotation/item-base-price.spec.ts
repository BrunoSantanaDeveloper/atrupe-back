import {
  basePriceOf,
  BasePriceContext,
  discountOverBase,
} from './item-base-price';
import { transformQuotationItem } from './quotation.transformers';

/**
 * O preço base do item na medida e na quantidade dele (EC-2, ALT-8,
 * revisão de 23/10/2026). Os números são de itens do homolog: com o preço
 * do cadastro, a base bate com o valor gravado.
 */
describe('basePriceOf', () => {
  const plain: BasePriceContext = { suggested: new Map(), tiers: true };
  const areaRow = (overrides: Record<string, unknown> = {}) => ({
    unitKind: 'AREA',
    quantity: 3,
    width: 1000,
    height: 1000,
    productItem: { unitCost: 0.013 },
    ...overrides,
  });

  it('produto simples: preço do cadastro × medida × quantidade', () => {
    // R$ 130,00/m², 1 m × 1 m, 3 peças
    expect(basePriceOf({ id: 'i', items: [areaRow()] }, plain)).toBe(39000);
  });

  it('não usa o preço editado da linha, só o do cadastro', () => {
    const item = {
      id: 'i',
      totalValue: 63000,
      items: [areaRow({ unitCost: 0.021 })],
    };
    expect(basePriceOf(item, plain)).toBe(39000);
  });

  it('a variação com preço vale no lugar do produto', () => {
    // R$ 25,00/m² na variação
    const item = {
      id: 'i',
      variation: { unitPrice: 2500 },
      items: [areaRow({ quantity: 1 })],
    };
    expect(basePriceOf(item, plain)).toBe(2500);
  });

  it('a variação sem preço fica com o preço do produto, sem faixa', () => {
    const item = {
      id: 'i',
      variation: { unitPrice: null },
      product: { priceTiers: [{ from: 1, unitPrice: 9900 }] },
      items: [areaRow({ quantity: 1 })],
    };
    expect(basePriceOf(item, plain)).toBe(13000);
  });

  it('a faixa de quantidade vale com o recurso do plano', () => {
    const item = {
      id: 'i',
      product: {
        priceTiers: [
          { from: 1, unitPrice: 2000 },
          { from: 10, unitPrice: 1500 },
        ],
      },
      items: [areaRow({ quantity: 12 })],
    };
    // R$ 15,00/m² a partir de 10 peças
    expect(basePriceOf(item, plain)).toBe(18000);
    expect(basePriceOf(item, { ...plain, tiers: false })).toBe(156000);
  });

  it('produto de várias linhas multiplica pela quantidade do item', () => {
    const item = {
      id: 'i',
      quantity: 2,
      items: [
        { unitKind: 'UNITY', quantity: 1, productItem: { unitCost: 500 } },
        {
          unitKind: 'LENGTH',
          quantity: 1,
          length: 2000,
          productItem: { unitCost: 1.5 },
        },
      ],
    };
    // (5,00 + 2 m × R$ 15,00/m) × 2
    expect(basePriceOf(item, plain)).toBe(7000);
  });

  it('o material de venda direta vale o próprio valor do cadastro', () => {
    expect(
      basePriceOf({ id: 'i', origin: 'MATERIAL', totalValue: 4500 }, plain),
    ).toBe(4500);
  });

  it('o item montado vale o preço sugerido do retrato', () => {
    const context = { ...plain, suggested: new Map([['i', 12345.6]]) };
    expect(basePriceOf({ id: 'i', origin: 'COMPOSED' }, context)).toBe(12346);
    expect(basePriceOf({ id: 'i', origin: 'COMPOSED' }, plain)).toBeNull();
  });

  it('sem referência é nulo: preço zero no cadastro ou linha sem preço', () => {
    expect(
      basePriceOf(
        { id: 'i', items: [areaRow({ productItem: { unitCost: 0 } })] },
        plain,
      ),
    ).toBeNull();
    expect(
      basePriceOf({ id: 'i', items: [areaRow({ productItem: null })] }, plain),
    ).toBeNull();
    expect(basePriceOf({ id: 'i', items: [] }, plain)).toBeNull();
  });
});

describe('transformQuotationItem — basePrice', () => {
  const qp = {
    id: 'i',
    origin: 'PRODUCT',
    productId: 'p',
    quantity: 1,
    totalValue: 63000,
    items: [
      {
        id: 'r',
        productItemId: 'pi',
        name: 'Lona',
        unitKind: 'AREA',
        quantity: 3,
        width: 1000,
        height: 1000,
        unitCost: 0.021,
        totalValue: 63000,
        productItem: { salePrice: 13000, unitCost: 0.013 },
      },
    ],
  };

  it('sai no detalhe, com o contexto', () => {
    const view = transformQuotationItem(qp, {
      suggested: new Map(),
      tiers: true,
    });
    expect(view.basePrice).toBe(39000);
  });

  it('fica de fora sem o contexto (a resposta de um item só)', () => {
    expect(transformQuotationItem(qp)).not.toHaveProperty('basePrice');
  });
});

/**
 * O limite de desconto sobre o preço base (ALT-8), a mesma conta da tela
 * (lib/discountLimit do front): a soma das bases contra o que os itens com
 * base valem (sem acréscimo e linhas), mais o desconto geral.
 */
describe('discountOverBase', () => {
  const plain: BasePriceContext = { suggested: new Map(), tiers: true };
  const material = (id: string, base: number, finalValue: number) => ({
    id,
    origin: 'MATERIAL',
    totalValue: base,
    finalValue,
    addition: 0,
    linesTotal: 0,
  });

  it('o preço abaixo da base é desconto, e o desconto geral soma', () => {
    expect(discountOverBase([material('a', 10000, 9000)], plain, 500)).toEqual({
      base: 10000,
      discount: 1500,
      percentage: 15,
    });
  });

  it('item acima da base compensa desconto em outro', () => {
    expect(
      discountOverBase(
        [material('a', 10000, 11000), material('b', 10000, 9000)],
        plain,
      ),
    ).toEqual({ base: 20000, discount: 0, percentage: 0 });
  });

  it('o acréscimo e as linhas ficam fora', () => {
    const item = {
      ...material('a', 10000, 17000),
      addition: 3000,
      linesTotal: 5000,
    };
    expect(discountOverBase([item], plain).percentage).toBe(10);
  });

  it('item sem preço base fica fora da conta', () => {
    const outsourced = {
      id: 'b',
      origin: 'OUTSOURCED',
      totalValue: 0,
      finalValue: 29000,
      linesTotal: 29000,
      items: [],
    };
    expect(discountOverBase([outsourced], plain)).toEqual({
      base: 0,
      discount: 0,
      percentage: 0,
    });
  });
});
