/**
 * Veículos, fase 1 (Maicol, 23/11/2026, ELITE): as contas da saída.
 */

export type StopForKm = {
  id: string;
  kind: 'WORK' | 'FREE';
  plannedKm: number | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * O km da volta repartido entre as paradas de trabalho pela proporção do km
 * previsto de cada uma (o excedente vai na mesma proporção: previsto 50, 35 e
 * 15, rodou 130 → 65, 45,5 e 19,5). Sem previsto, em partes iguais. As
 * paradas livres ficam com zero. A soma fecha no km rodado.
 */
export function allocateKm(stops: StopForKm[], km: number) {
  const work = stops.filter((stop) => stop.kind === 'WORK');
  const result = new Map<string, number>(stops.map((stop) => [stop.id, 0]));
  if (!work.length || !(km > 0)) return result;
  const planned = work.reduce((sum, stop) => sum + (stop.plannedKm || 0), 0);
  let used = 0;
  work.forEach((stop, index) => {
    const share =
      index === work.length - 1
        ? round1(km - used)
        : round1(
            planned > 0
              ? (km * (stop.plannedKm || 0)) / planned
              : km / work.length,
          );
    used += share;
    result.set(stop.id, share);
  });
  return result;
}

export type TripSpan = {
  id: string;
  vehicleId: string;
  driverId: string | null;
  teamIds: string[];
  departAt: Date;
  returnAt: Date;
  status: string;
};

const overlaps = (a: TripSpan, b: { departAt: Date; returnAt: Date }) =>
  a.departAt < b.returnAt && b.departAt < a.returnAt;

/**
 * O conflito de uma saída nova com as outras (VE-3): o mesmo veículo, ou a
 * mesma pessoa (dirigindo ou na equipe), em saídas que se sobrepõem.
 */
export function tripConflict(
  trip: Omit<TripSpan, 'id' | 'status'> & { id?: string },
  others: TripSpan[],
): string | null {
  const people = new Set(
    [trip.driverId, ...trip.teamIds].filter((id): id is string => !!id),
  );
  for (const other of others) {
    if (other.id === trip.id || other.status === 'CANCELED') continue;
    if (!overlaps(other, trip)) continue;
    if (other.vehicleId === trip.vehicleId) return 'VEHICLE';
    const otherPeople = [other.driverId, ...other.teamIds];
    if (otherPeople.some((id) => id && people.has(id))) return 'PERSON';
  }
  return null;
}

/**
 * Quem estava com o veículo (VE-2): a saída que cobre o momento, pelo
 * horário real (saiu e voltou) ou, sem ele, pelo previsto.
 */
export function tripAt<
  T extends {
    status: string;
    departAt: Date;
    returnAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  },
>(trips: T[], at: Date): T | null {
  return (
    trips.find((trip) => {
      if (trip.status === 'CANCELED') return false;
      const from = trip.startedAt ?? trip.departAt;
      const to =
        trip.finishedAt ??
        (trip.status === 'ON_ROUTE' ? new Date(8.64e15) : trip.returnAt);
      return from <= at && at <= to;
    }) ?? null
  );
}
