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
