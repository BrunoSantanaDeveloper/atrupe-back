import {
  kindFromUnitCode,
  normalizeUnitCode,
  resolveCommercialQuantity,
  unitCodeFromKind,
} from './commercial-quantity.util';

/**
 * Casos de referência espelhados de `calculateTotalQuantity`
 * (app-web/src/lib/quotation-display-utils.ts). A fórmula vive nos dois
 * repositórios; se um destes casos mudar aqui, a tela tem de mudar junto.
 */
describe('resolveCommercialQuantity', () => {
  const area = (over = {}) => ({
    quantity: 14,
    unitKind: 'AREA',
    width: 1000, // mm
    height: 1000, // mm
    ...over,
  });

  it('produto simples por área: 14 peças de 1m x 1m viram 14 M2', () => {
    // O caso da O.S. #6-T1: a tela mostra "14 un 1x1" e "14 m²".
    expect(resolveCommercialQuantity(1, [area()])).toEqual({
      quantity: 14,
      unit: 'M2',
    });
  });

  it('multiplica pela quantidade do item', () => {
    expect(resolveCommercialQuantity(3, [area({ quantity: 2 })])).toEqual({
      quantity: 6,
      unit: 'M2',
    });
  });

  it('converte milímetros para metros na área', () => {
    const r = resolveCommercialQuantity(1, [
      area({ quantity: 1, width: 2000, height: 3000 }),
    ]);
    expect(r).toEqual({ quantity: 6, unit: 'M2' });
  });

  it('produto por unidade multiplica as duas quantidades', () => {
    expect(
      resolveCommercialQuantity(3, [{ quantity: 2, unitKind: 'UNITY' }]),
    ).toEqual({ quantity: 6, unit: 'UN' });
  });

  it('comprimento em milímetros vira metros', () => {
    expect(
      resolveCommercialQuantity(2, [
        { quantity: 3, unitKind: 'LENGTH', length: 1500 },
      ]),
    ).toEqual({ quantity: 9, unit: 'M' });
  });

  it('peso em miligramas vira quilos', () => {
    expect(
      resolveCommercialQuantity(1, [
        { quantity: 2, unitKind: 'WEIGHT', weight: 500_000 },
      ]),
    ).toEqual({ quantity: 1, unit: 'KG' });
  });

  /**
   * Composição é conceito de produção: não tem NCM nem CFOP próprios
   * (ProductFiscalData.productId é @unique). A coisa vendida é a unidade
   * montada.
   */
  it('produto composto sai como unidade montada, sem somar as partes', () => {
    const composto = [
      { quantity: 1, unitKind: 'AREA', width: 2000, height: 1000 },
      { quantity: 4, unitKind: 'WEIGHT', weight: 250_000 },
    ];

    expect(resolveCommercialQuantity(3, composto)).toEqual({
      quantity: 3,
      unit: 'UN',
    });
  });

  it('sem composição carregada, cai na quantidade do item', () => {
    expect(resolveCommercialQuantity(5, [])).toEqual({
      quantity: 5,
      unit: 'UN',
    });
    expect(resolveCommercialQuantity(5, undefined)).toEqual({
      quantity: 5,
      unit: 'UN',
    });
  });

  /**
   * A tela mostra 0 quando falta dimensão. Aqui isso viraria qCOM = 0, que a
   * SEFAZ rejeita — então cai para UN em vez de emitir uma nota inválida.
   */
  it('item de área sem dimensão cai em UN em vez de zerar a quantidade', () => {
    const r = resolveCommercialQuantity(2, [
      { quantity: 3, unitKind: 'AREA', width: null, height: null },
    ]);

    expect(r).toEqual({ quantity: 6, unit: 'UN' });
  });
});

/**
 * Decisão de 15/11/2026: a nota segue a "Unidade comercial" do cadastro fiscal
 * do produto. A GrafK e as contas migradas cadastram a placa em UN e vendem
 * por peça; a nota saía "2,5 M2 x R$ 212" e o cliente lia valor errado.
 */
describe('resolveCommercialQuantity com a unidade cadastrada', () => {
  const placa = [{ quantity: 1, unitKind: 'AREA', width: 2500, height: 1000 }];

  it('UN cadastrada: a placa de 2,50 x 1,00 m sai como 1 UN', () => {
    expect(resolveCommercialQuantity(1, placa, 'UN')).toEqual({
      quantity: 1,
      unit: 'UN',
    });
  });

  it('M2 cadastrada: a mesma placa sai como 2,5 M2', () => {
    expect(resolveCommercialQuantity(1, placa, 'M2')).toEqual({
      quantity: 2.5,
      unit: 'M2',
    });
  });

  it('aceita "m²" escrito à mão no cadastro', () => {
    expect(resolveCommercialQuantity(1, placa, 'm²')).toEqual({
      quantity: 2.5,
      unit: 'M2',
    });
  });

  it('conta as peças das duas quantidades', () => {
    const seis = [{ quantity: 6, unitKind: 'AREA', width: 420, height: 300 }];

    expect(resolveCommercialQuantity(2, seis, 'UN')).toEqual({
      quantity: 12,
      unit: 'UN',
    });
  });

  it('peça leva a unidade cadastrada quando ela é de peça (PC, CX…)', () => {
    expect(resolveCommercialQuantity(1, placa, 'pc')).toEqual({
      quantity: 1,
      unit: 'PC',
    });
  });

  it('cadastro sem unidade conta as peças em UN', () => {
    expect(resolveCommercialQuantity(1, placa, null)).toEqual({
      quantity: 1,
      unit: 'UN',
    });
    expect(resolveCommercialQuantity(1, placa, '')).toEqual({
      quantity: 1,
      unit: 'UN',
    });
  });

  it('unidade de medida sem conversão não vira rótulo de peça', () => {
    // M3 é opção do cadastro, mas a composição guarda volume em mililitros:
    // quatro peças saíam "4 M3".
    const tambores = [{ quantity: 4, unitKind: 'CAPACITY', volume: 250_000 }];

    expect(resolveCommercialQuantity(1, tambores, 'M3')).toEqual({
      quantity: 4,
      unit: 'UN',
    });
    expect(resolveCommercialQuantity(1, placa, 'm3')).toEqual({
      quantity: 1,
      unit: 'UN',
    });
  });

  it('unidade de outra grandeza não converte a medida', () => {
    // KG cadastrado para um item vendido por área: não há como dizer a área
    // em quilos, então a nota conta as peças.
    expect(resolveCommercialQuantity(1, placa, 'KG')).toEqual({
      quantity: 1,
      unit: 'UN',
    });
  });

  it('comprimento com M cadastrado sai em metros', () => {
    const faixa = [{ quantity: 3, unitKind: 'LENGTH', length: 1500 }];

    expect(resolveCommercialQuantity(2, faixa, 'M')).toEqual({
      quantity: 9,
      unit: 'M',
    });
  });

  it('produto composto sai na unidade de peça cadastrada', () => {
    const composto = [
      { quantity: 1, unitKind: 'AREA', width: 2000, height: 1000 },
      { quantity: 4, unitKind: 'WEIGHT', weight: 250_000 },
    ];

    expect(resolveCommercialQuantity(3, composto, 'KIT')).toEqual({
      quantity: 3,
      unit: 'KIT',
    });
  });

  it('sem o argumento vale a regra anterior (relatório de vendidos)', () => {
    expect(resolveCommercialQuantity(1, placa)).toEqual({
      quantity: 2.5,
      unit: 'M2',
    });
  });
});

describe('normalizeUnitCode e kindFromUnitCode', () => {
  it('deixa o código no formato de uCom', () => {
    expect(normalizeUnitCode(' m² ')).toBe('M2');
    expect(normalizeUnitCode('un')).toBe('UN');
    expect(normalizeUnitCode('Unidade')).toBe('UNIDAD');
    expect(normalizeUnitCode(null)).toBe('');
  });

  it('reconhece as unidades de medida e conta o resto como peça', () => {
    expect(kindFromUnitCode('M2')).toBe('AREA');
    expect(kindFromUnitCode('m²')).toBe('AREA');
    expect(kindFromUnitCode('ML')).toBe('LENGTH');
    expect(kindFromUnitCode('LT')).toBe('CAPACITY');
    expect(kindFromUnitCode('KG')).toBe('WEIGHT');
    expect(kindFromUnitCode('KM')).toBe('DISTANCE');
    expect(kindFromUnitCode('HR')).toBe('DURATION');
    expect(kindFromUnitCode('UN')).toBe('UNITY');
    expect(kindFromUnitCode('CX')).toBe('UNITY');
    expect(kindFromUnitCode('M3')).toBe('OTHER');
  });
});

describe('unitCodeFromKind', () => {
  it('devolve códigos ASCII de no máximo 6 caracteres', () => {
    const kinds = [
      'AREA',
      'LENGTH',
      'CAPACITY',
      'WEIGHT',
      'DISTANCE',
      'DURATION',
      'UNITY',
      'DESCONHECIDO',
    ];

    for (const kind of kinds) {
      const code = unitCodeFromKind(kind);
      expect(code).toMatch(/^[A-Z0-9]{1,6}$/);
    }
  });

  it('usa M2, e não m², porque uCom não aceita bem não-ASCII', () => {
    expect(unitCodeFromKind('AREA')).toBe('M2');
  });
});
