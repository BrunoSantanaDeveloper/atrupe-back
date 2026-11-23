import { areaOf, batchShares, batchWaste } from './lot-batch';

describe('a baixa conjunta (VS-2)', () => {
  const consumption = (m2: number) => [
    { resourceId: 'material:lona', resource: 'Lona', unit: 'm²', quantity: m2 },
    {
      resourceId: 'material:ilhos',
      resource: 'Ilhós',
      unit: 'un',
      quantity: 8,
    },
  ];

  it('a área do trabalho é a dos materiais vendidos em m²', () => {
    expect(areaOf(consumption(3))).toBe(3);
    expect(areaOf([{ resourceId: 'machine:x', unit: 'h' }])).toBeNull();
  });

  it('divide o comprimento pela área de cada trabalho e fecha na soma', () => {
    const shares = batchShares(
      [
        { id: 'a', area: 3 },
        { id: 'b', area: 1 },
      ],
      10,
    );
    expect(shares.map((share) => share.length)).toEqual([7.5, 2.5]);
  });

  it('sem área em algum trabalho, em partes iguais', () => {
    const shares = batchShares(
      [
        { id: 'a', area: 3 },
        { id: 'b', area: null },
        { id: 'c', area: 2 },
      ],
      9,
    );
    expect(shares.map((share) => share.length)).toEqual([3, 3, 3]);
  });

  it('o refugo é a área gasta menos a impressa', () => {
    expect(batchWaste([{ area: 3 }, { area: 1 }], 5)).toEqual({
      printed: 4,
      used: 5,
      waste: 1,
      percent: 20,
    });
    expect(batchWaste([{ area: null }], 5)).toBeNull();
  });
});
