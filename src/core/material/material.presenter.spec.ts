import {
  MaterialRow,
  toMaterialResponse,
  toPricingItem,
} from './material.presenter';

const variation = (over: Record<string, unknown> = {}) =>
  ({
    id: 'v-1',
    materialId: 'm-1',
    brand: 'Marca X',
    color: 'Branca',
    matchKey: 'marca x|branca',
    cost: 1250,
    price: 2800,
    desiredMargin: null,
    costUpdatedAt: null,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    ...over,
  }) as MaterialRow['variations'][number];

const material = (over: Record<string, unknown> = {}) =>
  ({
    id: 'm-1',
    companyId: 'c-1',
    number: 6,
    code: 'MAT-06',
    name: 'Metalon 50 × 30',
    searchName: 'metalon 50 × 30',
    sectorId: 's-3',
    subcategory: 'Perfis',
    unit: 'M',
    directSale: false,
    productionMaterial: true,
    priceRule: 'FIXED',
    cost: 1850,
    price: null,
    desiredMargin: null,
    costUpdatedAt: null,
    active: true,
    shape: 'PROFILE',
    profileX: 50,
    profileY: 30,
    barLength: 6000,
    sheetWidth: null,
    sheetHeight: null,
    wholeSheets: true,
    weight: 1.9,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    sector: { name: 'Serralheria' },
    variations: [],
    ...over,
  }) as MaterialRow;

describe('resposta do material', () => {
  it('com a permissão de valores, vem no formato do contrato', () => {
    expect(toMaterialResponse(material(), { values: true })).toEqual({
      id: 'm-1',
      code: 'MAT-06',
      name: 'Metalon 50 × 30',
      sectorId: 's-3',
      sector: 'Serralheria',
      subcategory: 'Perfis',
      unit: 'M',
      directSale: false,
      productionMaterial: true,
      priceRule: 'FIXED',
      cost: 1850,
      price: null,
      margin: null,
      priceStatus: 'PENDING',
      variations: [],
      active: true,
      advanced: {
        shape: 'PROFILE',
        x: 50,
        y: 30,
        barLength: 6000,
        width: null,
        height: null,
        wholeSheets: true,
        weight: 1.9,
      },
      fiscal: {},
    });
  });

  it('os dados fiscais da venda direta saem só com os campos conhecidos', () => {
    const response = toMaterialResponse(
      material({
        fiscal: { ncm: '39269090', cfopInState: '5102', outro: 'x', cest: '' },
      } as never),
      { values: true },
    );
    expect((response as { fiscal: unknown }).fiscal).toEqual({
      ncm: '39269090',
      cfopInState: '5102',
    });
  });

  it('a variação traz custo, preço, margem e situação', () => {
    const response = toMaterialResponse(
      material({ cost: null, variations: [variation()] }),
      { values: true },
    );

    expect(response.variations).toEqual([
      {
        id: 'v-1',
        brand: 'Marca X',
        color: 'Branca',
        cost: 1250,
        price: 2800,
        margin: 55.4,
        priceStatus: 'PRICED',
      },
    ]);
  });

  it('sem a permissão de valores, custo e preço não saem em lugar nenhum', () => {
    const response = toMaterialResponse(
      material({ variations: [variation()] }),
      { values: false },
    );

    for (const key of ['cost', 'price', 'margin', 'priceStatus']) {
      expect(response).not.toHaveProperty(key);
      expect(response.variations[0]).not.toHaveProperty(key);
    }
    expect(response.variations).toEqual([
      { id: 'v-1', brand: 'Marca X', color: 'Branca' },
    ]);
    expect(response).toMatchObject({ name: 'Metalon 50 × 30', active: true });
  });

  it('sem configuração avançada, o bloco vem nulo', () => {
    expect(
      toMaterialResponse(material({ shape: null }), { values: true }),
    ).toMatchObject({ advanced: null });
  });

  describe('busca de venda direta do orçamento', () => {
    const row = material({
      directSale: true,
      price: 3200,
      variations: [variation()],
    });

    it('traz só o que o vendedor escolhe, e nunca o custo', () => {
      expect(
        toMaterialResponse(row, { values: true, directSale: true }),
      ).toEqual({
        id: 'm-1',
        code: 'MAT-06',
        name: 'Metalon 50 × 30',
        sector: 'Serralheria',
        unit: 'M',
        price: 3200,
        variations: [
          { id: 'v-1', brand: 'Marca X', color: 'Branca', price: 2800 },
        ],
      });
    });

    it('sem a permissão de valores, nem o preço', () => {
      expect(
        toMaterialResponse(row, { values: false, directSale: true }),
      ).toEqual({
        id: 'm-1',
        code: 'MAT-06',
        name: 'Metalon 50 × 30',
        sector: 'Serralheria',
        unit: 'M',
        variations: [{ id: 'v-1', brand: 'Marca X', color: 'Branca' }],
      });
    });
  });
});

describe('material como item da Precificação', () => {
  it('sem variação, o id é mat:<material>', () => {
    expect(toPricingItem(material({ price: 2600 }))).toEqual({
      id: 'mat:m-1',
      name: 'Metalon 50 × 30',
      code: 'MAT-06',
      sector: 'Serralheria',
      unit: 'm',
      cost: 1850,
      costUpdatedAt: null,
      rule: 'FIXED',
      price: 2600,
      margin: 28.8,
      status: 'PRICED',
    });
  });

  it('com variação, o item é a variação', () => {
    const item = variation();
    const row = material({
      name: 'Lona 440',
      code: 'MAT-01',
      unit: 'M2',
      priceRule: 'VARIABLE',
      cost: null,
      variations: [item],
    });

    expect(toPricingItem(row, item)).toMatchObject({
      id: 'mat:m-1:v-1',
      name: 'Lona 440 · Marca X Branca',
      unit: 'm²',
      cost: 1250,
      rule: 'VARIABLE',
      price: 2800,
      margin: 55.4,
      status: 'PRICED',
    });
  });
});
