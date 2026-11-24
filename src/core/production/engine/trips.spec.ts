import { allocateKm, tripAt, tripConflict } from './trips';

describe('as saídas dos veículos (fase 1)', () => {
  it('reparte o km pelo previsto, o excedente na mesma proporção', () => {
    const result = allocateKm(
      [
        { id: 'a', kind: 'WORK', plannedKm: 50 },
        { id: 'b', kind: 'WORK', plannedKm: 35 },
        { id: 'c', kind: 'WORK', plannedKm: 15 },
        { id: 'banco', kind: 'FREE', plannedKm: null },
      ],
      130,
    );
    expect(Object.fromEntries(result)).toEqual({
      a: 65,
      b: 45.5,
      c: 19.5,
      banco: 0,
    });
  });

  it('sem previsto, em partes iguais', () => {
    const result = allocateKm(
      [
        { id: 'a', kind: 'WORK', plannedKm: null },
        { id: 'b', kind: 'WORK', plannedKm: null },
      ],
      30,
    );
    expect(Object.fromEntries(result)).toEqual({ a: 15, b: 15 });
  });

  it('o resto do arredondamento vai para a de maior peso, sem negativo, e a soma fecha', () => {
    // Antes: 12,6, 12,6 e -0,1
    const result = allocateKm(
      [
        { id: 'a', kind: 'WORK', plannedKm: 10 },
        { id: 'b', kind: 'WORK', plannedKm: 10 },
        { id: 'c', kind: 'WORK', plannedKm: null },
      ],
      25.1,
    );
    expect(Object.fromEntries(result)).toEqual({ a: 12.6, b: 12.5, c: 0 });
    const tenths = (map: Map<string, number>) =>
      Math.round([...map.values()].reduce((sum, km) => sum + km, 0) * 10);
    expect(tenths(result)).toBe(251);

    // Muitas paradas e pouco km: ninguém fica negativo
    const small = allocateKm(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
        id,
        kind: 'WORK' as const,
        plannedKm: 1,
      })),
      0.3,
    );
    expect([...small.values()].every((km) => km >= 0)).toBe(true);
    expect(tenths(small)).toBe(3);

    // A de maior peso leva o resto
    const heavy = allocateKm(
      [
        { id: 'a', kind: 'WORK', plannedKm: 1 },
        { id: 'b', kind: 'WORK', plannedKm: 1 },
        { id: 'c', kind: 'WORK', plannedKm: 2 },
      ],
      10.1,
    );
    expect(Object.fromEntries(heavy)).toEqual({ a: 2.5, b: 2.5, c: 5.1 });
  });

  const day = (h: number) => new Date(Date.UTC(2026, 10, 24, h));
  const trip = (over: object) => ({
    id: 't1',
    vehicleId: 'v1',
    driverId: 'p1',
    teamIds: ['p2'],
    departAt: day(8),
    returnAt: day(12),
    status: 'SCHEDULED',
    ...over,
  });

  it('o mesmo veículo ou a mesma pessoa não estão em duas saídas ao mesmo tempo', () => {
    const others = [trip({})];
    expect(
      tripConflict(
        {
          vehicleId: 'v1',
          driverId: 'p9',
          teamIds: [],
          departAt: day(10),
          returnAt: day(14),
        },
        others,
      ),
    ).toBe('VEHICLE');
    expect(
      tripConflict(
        {
          vehicleId: 'v2',
          driverId: 'p9',
          teamIds: ['p2'],
          departAt: day(10),
          returnAt: day(14),
        },
        others,
      ),
    ).toBe('PERSON');
    expect(
      tripConflict(
        {
          vehicleId: 'v1',
          driverId: 'p1',
          teamIds: [],
          departAt: day(12),
          returnAt: day(14),
        },
        others,
      ),
    ).toBeNull();
  });

  it('quem estava com o veículo pelo horário real ou previsto', () => {
    const trips = [
      { ...trip({}), startedAt: day(9), finishedAt: day(11) },
      {
        ...trip({ id: 't2', departAt: day(13), returnAt: day(15) }),
        startedAt: null,
        finishedAt: null,
      },
    ];
    expect(tripAt(trips, day(10))?.id).toBe('t1');
    expect(tripAt(trips, day(12))).toBeNull();
    expect(tripAt(trips, day(14))?.id).toBe('t2');
  });
});
