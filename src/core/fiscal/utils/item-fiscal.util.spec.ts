import { itemFiscalData, pickMaterialFiscal } from './item-fiscal.util';
import {
  materialUnitCode,
  resolveCommercialQuantity,
} from './commercial-quantity.util';

describe('fiscal do item sem produto (PO, 14/10/2026)', () => {
  it('o item montado usa o padrão do emissor, com o CST do regime', () => {
    expect(
      itemFiscalData({
        defaultNcm: '49111090',
        defaultCfop: '5102',
        emitCrt: 1,
      }),
    ).toMatchObject({
      ncm: '49111090',
      cfopInState: '5102',
      cfopOutState: '6101',
      icmsCst: '102',
      pisCst: '99',
      cofinsCst: '99',
    });
    expect(itemFiscalData({ emitCrt: 3 })).toMatchObject({
      ncm: '49119900',
      cfopInState: '5101',
      icmsCst: '00',
    });
  });

  it('o material de venda direta vale por cima do padrão', () => {
    expect(
      itemFiscalData(
        { defaultNcm: '49111090', defaultCfop: '5102', emitCrt: 1 },
        { ncm: '39269090', cfopOutState: '6102', icmsCst: '500' },
      ),
    ).toMatchObject({
      ncm: '39269090',
      cfopInState: '5102',
      cfopOutState: '6102',
      icmsCst: '500',
    });
  });

  it('do JSON do material só saem os campos conhecidos com texto', () => {
    expect(
      pickMaterialFiscal({
        ncm: ' 39269090 ',
        cest: '',
        outro: 'x',
        icmsCst: 5,
      }),
    ).toEqual({ ncm: '39269090' });
    expect(pickMaterialFiscal(null)).toEqual({});
  });

  it('a quantidade comercial do material sai na unidade dele', () => {
    expect(resolveCommercialQuantity(14, [], materialUnitCode('M2'))).toEqual({
      quantity: 14,
      unit: 'M2',
    });
    expect(materialUnitCode('LT')).toBe('L');
    expect(materialUnitCode('HR')).toBe('H');
    // Sem unidade própria, como antes
    expect(resolveCommercialQuantity(3, [])).toEqual({
      quantity: 3,
      unit: 'UN',
    });
  });
});
