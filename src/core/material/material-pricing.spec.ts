import { marginOf, priceStatusOf, variablePriceOf } from './material-pricing';
import {
  materialCode,
  normalizeText,
  unitFromText,
  variationKey,
} from './material-text';

const NO_CHARGES = { taxation: 0, financialCost: 0, commission: 0 };

describe('preço do material', () => {
  describe('margem', () => {
    it('é (preço − custo) ÷ preço, com uma casa', () => {
      // Os dois exemplos do contrato
      expect(marginOf(1250, 2800)).toBe(55.4);
      expect(marginOf(1420, 3100)).toBe(54.2);
    });

    it('fica negativa quando o preço não paga o custo', () => {
      expect(marginOf(4200, 3900)).toBe(-7.7);
    });

    it('não existe sem custo ou sem preço', () => {
      expect(marginOf(null, 2800)).toBeNull();
      expect(marginOf(1250, null)).toBeNull();
      expect(marginOf(1250, 0)).toBeNull();
    });
  });

  describe('situação', () => {
    it.each([
      [null, 2800, 'NO_COST'],
      [null, null, 'NO_COST'],
      [1250, null, 'PENDING'],
      [1250, 0, 'PENDING'],
      [1250, 1000, 'BELOW_COST'],
      [1250, 1250, 'PRICED'],
      [1250, 2800, 'PRICED'],
    ])('custo %p e preço %p → %s', (cost, price, status) => {
      expect(priceStatusOf(cost, price)).toBe(status);
    });
  });

  describe('preço variável', () => {
    it('sem encargos, é custo ÷ (1 − lucro)', () => {
      // 1250 ÷ 0,7 = 1785,71
      expect(variablePriceOf(1250, 300, NO_CHARGES)).toBe(1786);
    });

    it('com os encargos da Precificação, eles entram no divisor', () => {
      // 6,0 % + 1,5 % + 3,0 % + 30,0 % = 40,5 %; 1250 ÷ 0,595 = 2100,84
      expect(
        variablePriceOf(1250, 300, {
          taxation: 60,
          financialCost: 15,
          commission: 30,
        }),
      ).toBe(2101);
    });

    it('arredonda ao centavo', () => {
      // 1850 ÷ 0,667 = 2773,61
      expect(variablePriceOf(1850, 333, NO_CHARGES)).toBe(2774);
    });

    it('não há preço quando encargos e lucro somam 100 % ou mais', () => {
      expect(variablePriceOf(1250, 1000, NO_CHARGES)).toBeNull();
      expect(
        variablePriceOf(1250, 900, {
          taxation: 60,
          financialCost: 15,
          commission: 30,
        }),
      ).toBeNull();
    });
  });
});

describe('texto do material', () => {
  it('normaliza: minúsculas, sem acento, espaços colapsados', () => {
    expect(normalizeText('  Lona   440 ')).toBe('lona 440');
    expect(normalizeText('MDF Cru AÇAÍ')).toBe('mdf cru acai');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });

  it.each([
    ['m²', 'M2'],
    ['M2', 'M2'],
    ['mq', 'M2'],
    ['Metro Quadrado', 'M2'],
    ['m', 'M'],
    ['ml', 'M'],
    ['Metro linear', 'M'],
    ['un', 'UN'],
    ['Unid', 'UN'],
    ['pç', 'UN'],
    ['PC', 'UN'],
    ['folha', 'UN'],
    ['chapa', 'UN'],
    ['kg', 'KG'],
    ['Quilo', 'KG'],
    ['l', 'LT'],
    ['LT', 'LT'],
    ['litro', 'LT'],
    ['h', 'HR'],
    ['hora', 'HR'],
    ['km', 'KM'],
  ])('a unidade %p da planilha é %s', (text, unit) => {
    expect(unitFromText(text)).toBe(unit);
  });

  it('unidade fora da tabela não é reconhecida', () => {
    expect(unitFromText('caixa')).toBeNull();
    expect(unitFromText('')).toBeNull();
    expect(unitFromText(undefined)).toBeNull();
  });

  it('o código é MAT-nn, com ao menos duas casas', () => {
    expect(materialCode(1)).toBe('MAT-01');
    expect(materialCode(12)).toBe('MAT-12');
    expect(materialCode(123)).toBe('MAT-123');
  });

  it('a combinação marca × cor ignora caixa e acento', () => {
    expect(variationKey('Marca X', 'Branca')).toBe('marca x|branca');
    expect(variationKey(' MARCA x ', 'Brancá')).toBe('marca x|branca');
  });
});
