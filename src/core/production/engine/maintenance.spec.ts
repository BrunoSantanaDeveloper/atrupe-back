import { addMonths, maintenanceBlocks } from './maintenance';

const cost = {
  id: 'c1',
  name: 'Troca da cabeça',
  machine: 'Plotter Roland',
  lastOccurrence: '2026-09-23',
  everyMonths: 2,
  start: '14:00',
  minutes: 120,
};

describe('manutenção que bloqueia a agenda (GP-49 item 6)', () => {
  it('a próxima data é a última mais a periodicidade', () => {
    expect(
      maintenanceBlocks([cost], '2026-11-01', '2027-01-31').map(
        (block) => block.date,
      ),
    ).toEqual(['2026-11-23', '2027-01-23']);
  });

  it('o mês curto prende ao último dia', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 2)).toBe('2027-02-15');
  });

  it('fora do período não entra; sem duração, não bloqueia', () => {
    expect(maintenanceBlocks([cost], '2026-11-24', '2026-12-31')).toEqual([]);
    expect(
      maintenanceBlocks([{ ...cost, minutes: 0 }], '2026-01-01', '2027-12-31'),
    ).toEqual([]);
  });
});
