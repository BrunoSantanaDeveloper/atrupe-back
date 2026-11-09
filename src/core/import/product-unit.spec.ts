import {
  displayToRawUnitCost,
  importedItemPrices,
  lineQuantities,
  lineRawMeasure,
  lineUnitCost,
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

describe('lineUnitCost', () => {
  it('em área, a taxa vezes a área e a quantidade da linha dá o total', () => {
    // 3 peças de 1,00 × 2,00 m por R$ 360,00: R$ 60,00/m².
    const taxa = lineUnitCost(36000, 'AREA', { width: 1000, height: 2000 }, 3);

    expect(taxa * 1000 * 2000 * 3).toBeCloseTo(36000, 6);
    expect(taxa * 1_000_000).toBeCloseTo(6000, 6);
  });

  it('em unidade, a taxa é o total dividido pela quantidade da linha', () => {
    expect(lineUnitCost(36000, 'UNITY', {}, 3)).toBe(12000);
    expect(lineUnitCost(36000, null, {}, 3)).toBe(12000);
  });

  it('sem medida, devolve o próprio total em vez de dividir por zero', () => {
    expect(lineUnitCost(36000, 'AREA', { width: null, height: 2000 }, 3)).toBe(
      36000,
    );
    expect(lineUnitCost(null, 'AREA', { width: 1000, height: 2000 }, 3)).toBe(
      null,
    );
  });

  it('a medida da unidade avulsa é a quantidade', () => {
    expect(lineRawMeasure('UNITY', {}, 4)).toBe(4);
    expect(lineRawMeasure('LENGTH', { length: 1500 }, 4)).toBe(1500);
  });
});

describe('lineQuantities', () => {
  it('na linha de uma composição, a quantidade vai na composição', () => {
    // É como a tela grava; o modal desse produto lê só a da composição.
    expect(lineQuantities(110, 1)).toEqual({ line: 1, composition: 110 });
  });

  it('no produto composto, a quantidade fica na linha', () => {
    expect(lineQuantities(3, 2)).toEqual({ line: 3, composition: 1 });
  });

  it('linha sem composição ou sem quantidade fica como veio', () => {
    expect(lineQuantities(3, 0)).toEqual({ line: 3, composition: 1 });
    expect(lineQuantities(0, 1)).toEqual({ line: 0, composition: 1 });
  });
});
