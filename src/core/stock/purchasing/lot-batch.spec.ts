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

  it('a área do trabalho é a do material do rolo, vendido em m²', () => {
    const lona = { replaces: null, lot: 'lona|' };
    expect(areaOf(consumption(3), lona)).toBe(3);
    expect(areaOf([{ resourceId: 'machine:x', unit: 'h' }], lona)).toBeNull();
    // O rolo de outro material, sem troca: a área não é conhecida
    expect(areaOf(consumption(3), { replaces: null, lot: 'vinil|' })).toBe(
      null,
    );
    // O material por unidade não dá área
    expect(areaOf(consumption(3), { replaces: 'ilhos|', lot: 'lona|' })).toBe(
      null,
    );
  });

  it('a lona e a laminação na mesma etapa: conta só o material do rolo', () => {
    const both = [
      ...consumption(3),
      {
        resourceId: 'material:laminacao',
        resource: 'Laminação',
        unit: 'm²',
        quantity: 3,
      },
    ];
    // Antes: 6 m² (as duas somadas)
    expect(areaOf(both, { replaces: null, lot: 'lona|' })).toBe(3);
    // O rolo de outra lona no lugar da vendida: a área da vendida
    expect(areaOf(both, { replaces: 'lona|', lot: 'lona-b|' })).toBe(3);
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
