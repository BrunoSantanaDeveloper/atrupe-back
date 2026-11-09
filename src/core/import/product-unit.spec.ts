import {
  displayToRawUnitCost,
  importedItemPrices,
  unitKindFromCode,
} from './product-unit';

describe('unitKindFromCode', () => {
  it('reconhece as unidades de cobrança do legado', () => {
    // Tabela ven_servico_un_com: 1 UN, 2 M2, 3 KG, 4 LT, 5 M, 6 HH, 7 KM.
    expect(unitKindFromCode('UN')).toBe('UNITY');
    expect(unitKindFromCode('M2')).toBe('AREA');
    expect(unitKindFromCode('KG')).toBe('WEIGHT');
    expect(unitKindFromCode('LT')).toBe('CAPACITY');
    expect(unitKindFromCode('M')).toBe('LENGTH');
    expect(unitKindFromCode('KM')).toBe('DISTANCE');
  });

  it('lê "HH" como hora', () => {
    // Antes caía em unidade avulsa, e o serviço cobrado por hora (o "CORTE
    // LASER" da Terabyte) entrava como peça.
    expect(unitKindFromCode('HH')).toBe('DURATION');
  });

  it('ignora caixa e espaço nas pontas', () => {
    expect(unitKindFromCode(' m² ')).toBe('AREA');
    expect(unitKindFromCode('km')).toBe('DISTANCE');
  });

  it('trata código que não é de medida como unidade avulsa', () => {
    expect(unitKindFromCode('PC')).toBe('UNITY');
    expect(unitKindFromCode('tempo')).toBe('UNITY');
  });

  it('não inventa unidade quando o código vem vazio', () => {
    expect(unitKindFromCode('')).toBeNull();
    expect(unitKindFromCode('   ')).toBeNull();
    expect(unitKindFromCode(null)).toBeNull();
  });
});

describe('displayToRawUnitCost', () => {
  it('passa o valor por unidade de exibição para a unidade bruta', () => {
    expect(displayToRawUnitCost(6000, 'AREA')).toBeCloseTo(0.006, 12);
    expect(displayToRawUnitCost(94, 'LENGTH')).toBeCloseTo(0.094, 12);
    expect(displayToRawUnitCost(3600, 'DURATION')).toBe(1);
  });

  it('mantém o valor da unidade avulsa e o da linha sem unidade', () => {
    expect(displayToRawUnitCost(3000, 'UNITY')).toBe(3000);
    expect(displayToRawUnitCost(3000, null)).toBe(3000);
  });

  it('não converte valor vazio ou zero', () => {
    expect(displayToRawUnitCost(null, 'AREA')).toBeNull();
    expect(displayToRawUnitCost(0, 'AREA')).toBe(0);
  });
});

describe('importedItemPrices', () => {
  it('produto por m² sem medida fica sem total', () => {
    // R$ 30,00/m²: taxa de 0,003 centavo por mm². Gravar a taxa como total
    // faria a listagem mostrar 0,00.
    const prices = importedItemPrices(3000, 'AREA');

    expect(prices.unitCost).toBeCloseTo(0.003, 12);
    expect(prices.salePrice).toBeNull();
  });

  it('produto por m² com medida tem o total da peça', () => {
    // 1 m × 2 m a R$ 30,00/m² = R$ 60,00.
    const prices = importedItemPrices(3000, 'AREA', {
      widthMm: 1000,
      heightMm: 2000,
    });

    expect(prices.salePrice).toBeCloseTo(6000, 6);
  });

  it('unidade avulsa tem o valor unitário como total', () => {
    expect(importedItemPrices(3000, 'UNITY')).toEqual({
      unitCost: 3000,
      salePrice: 3000,
    });
    expect(importedItemPrices(3000, null)).toEqual({
      unitCost: 3000,
      salePrice: 3000,
    });
  });
});
