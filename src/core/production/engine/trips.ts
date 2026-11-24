/**
 * Veículos, fase 1 (Maicol, 23/11/2026, ELITE): as contas da saída.
 */

export type StopForKm = {
  id: string;
  kind: 'WORK' | 'FREE';
  plannedKm: number | null;
};

/** O km com uma casa (o que a tela mostra e o que se grava). */
export const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * O km da volta repartido entre as paradas de trabalho pela proporção do km
 * previsto de cada uma (o excedente vai na mesma proporção: previsto 50, 35 e
 * 15, rodou 130 → 65, 45,5 e 19,5). Sem previsto, em partes iguais; a parada
 * de trabalho sem previsto, quando outras têm, fica com zero. As paradas
 * livres ficam com zero.
 *
 * A conta é em décimos de km: cada parada fica com a sua parte arredondada
 * para baixo, e o resto do arredondamento vai para a parada de maior peso.
 * Assim nenhuma fica negativa e a soma fecha exatamente no km rodado (com
 * uma casa): 10, 10 e sem previsto, rodou 25,1 → 12,6, 12,5 e 0.
 */
export function allocateKm(stops: StopForKm[], km: number) {
  const work = stops.filter((stop) => stop.kind === 'WORK');
  const result = new Map<string, number>(stops.map((stop) => [stop.id, 0]));
  const tenths = Math.round(km * 10);
  if (!work.length || !(tenths > 0)) return result;
  const planned = work.reduce(
    (sum, stop) => sum + Math.max(stop.plannedKm || 0, 0),
    0,
  );
  const weights = work.map((stop) =>
    planned > 0 ? Math.max(stop.plannedKm || 0, 0) : 1,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight) =>
    Math.floor((tenths * weight) / total + 1e-9),
  );
  // O resto vai para a de maior peso (a primeira, no empate)
  const heaviest = weights.indexOf(Math.max(...weights));
  shares[heaviest] += tenths - shares.reduce((sum, share) => sum + share, 0);
  work.forEach((stop, index) => result.set(stop.id, shares[index] / 10));
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
