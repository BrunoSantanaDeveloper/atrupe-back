import { installmentsOf, splitLot, unitCostOf, useLot } from './lot-math';

// O rolo do levantamento: adesivo 1,22 × 50 m = 61 m², R$ 233,75
const roll = {
  measure: 'ROLL' as const,
  quantity: 61,
  width: 1.22,
  length: 50,
  currentQuantity: 61,
  currentWidth: 1.22,
  currentLength: 50,
  cost: 23375,
};

describe('lote (ES-8 a ES-12)', () => {
  it('a baixa em metros tira a área na largura atual', () => {
    expect(useLot(roll, { length: 3 })).toEqual({
      used: 3.66,
      currentQuantity: 57.34,
      currentWidth: 1.22,
      currentLength: 47,
    });
  });

  it('a sobra medida: o rolo que ficou com 0,50 × 47 m', () => {
    const result = useLot(roll, { width: 0.5, length: 47, remaining: true });
    expect(result.currentQuantity).toBe(23.5);
    expect(result.used).toBe(37.5);
  });

  it('não sai mais do que o lote tem', () => {
    expect(() => useLot(roll, { length: 51 })).toThrow('Saiu mais');
    expect(() =>
      useLot(
        { ...roll, measure: 'UNIT', width: null, length: null },
        {
          quantity: 62,
        },
      ),
    ).toThrow('Saiu mais');
  });

  it('dividir pelo comprimento leva a parte do custo', () => {
    const { piece, rest } = splitLot(roll, { length: 10 });
    expect(piece).toEqual({
      quantity: 12.2,
      width: 1.22,
      length: 10,
      cost: 4675,
    });
    expect(rest).toEqual({
      currentQuantity: 48.8,
      currentWidth: 1.22,
      currentLength: 40,
    });
  });

  it('dividir por quantidade: o pedaço sai do comprimento e o resto encolhe', () => {
    // O rolo de 1,5 × 50 m = 75 m², separando 15 m²
    const big = {
      measure: 'ROLL' as const,
      quantity: 75,
      width: 1.5,
      length: 50,
      currentQuantity: 75,
      currentWidth: 1.5,
      currentLength: 50,
      cost: 75000,
    };
    const { piece, rest } = splitLot(big, { quantity: 15 });
    expect(piece).toEqual({
      quantity: 15,
      width: 1.5,
      length: 10,
      cost: 15000,
    });
    expect(rest).toEqual({
      currentQuantity: 60,
      currentWidth: 1.5,
      currentLength: 40,
    });
  });

  it('a sobra medida precisa das duas medidas maiores que zero', () => {
    expect(() =>
      useLot(roll, { width: 0, length: 0, remaining: true }),
    ).toThrow('maiores que zero');
    expect(() =>
      useLot(roll, { width: 1, length: 0, remaining: true }),
    ).toThrow('maiores que zero');
  });

  it('as parcelas não passam do total em centavos', () => {
    expect(() => installmentsOf(2, 3, '2026-12-10')).toThrow(
      'pelo menos um centavo',
    );
    expect(
      installmentsOf(3, 3, '2026-12-10').map((part) => part.amount),
    ).toEqual([1, 1, 1]);
  });

  it('o custo por unidade do material', () => {
    expect(unitCostOf(roll)).toBe(383);
  });

  it('as parcelas: o resto na primeira, de 30 em 30 dias', () => {
    expect(installmentsOf(10000, 3, '2026-12-10')).toEqual([
      { number: 1, amount: 3334, dueDate: '2026-12-10' },
      { number: 2, amount: 3333, dueDate: '2027-01-09' },
      { number: 3, amount: 3333, dueDate: '2027-02-08' },
    ]);
  });
});
