import {
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
