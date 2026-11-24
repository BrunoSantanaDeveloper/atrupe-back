import {
  lastBlockDay,
  machineConflicts,
  occupiedBlocks,
  scheduleBlocks,
} from './task-blocks';

/** Os blocos de agenda da tarefa (GP-52): cada dia com o que é dele. */
describe('os blocos de agenda (GP-52)', () => {
  const split = {
    scheduleDate: new Date('2026-11-24T00:00:00Z'),
    scheduleStart: '08:00',
    scheduleMinutes: 240,
    estimatedMinutes: 480,
    setupMinutes: 30,
    slots: [
      {
        id: 'sl-2',
        date: new Date('2026-11-25T00:00:00Z'),
        start: '08:00',
        minutes: 240,
        kind: 'NORMAL' as const,
      },
    ],
  };

  it('o trabalho dividido ocupa 240 em cada dia e soma o total', () => {
    const blocks = occupiedBlocks(split);
    expect(blocks.map((block) => [block.date, block.minutes])).toEqual([
      ['2026-11-24', 240],
      ['2026-11-25', 240],
    ]);
    expect(blocks.reduce((sum, block) => sum + block.minutes, 0)).toBe(480);
  });

  it('sem outros blocos, o bloco 1 ocupa o maior entre previsto, preparo e agendado', () => {
    expect(
      occupiedBlocks({ ...split, slots: [], scheduleMinutes: 60 }).map(
        (block) => block.minutes,
      ),
    ).toEqual([480]);
  });

  it('a tela mostra o bloco 1 e os outros por dia, com os minutos de cada um', () => {
    expect(
      scheduleBlocks({
        ...split,
        slots: [
          {
            id: 'sl-3',
            date: '2026-11-27',
            start: null,
            minutes: 60,
            kind: 'EXTRA',
            reason: 'retrabalho',
          },
          ...split.slots,
        ],
      }),
    ).toEqual([
      {
        slotId: null,
        date: '2026-11-24',
        start: '08:00',
        minutes: 240,
        kind: 'NORMAL',
        reason: null,
      },
      {
        slotId: 'sl-2',
        date: '2026-11-25',
        start: '08:00',
        minutes: 240,
        kind: 'NORMAL',
        reason: null,
      },
      {
        slotId: 'sl-3',
        date: '2026-11-27',
        start: null,
        minutes: 60,
        kind: 'EXTRA',
        reason: 'retrabalho',
      },
    ]);
  });

  it('fora da agenda (sem o bloco 1), nenhum bloco conta', () => {
    expect(occupiedBlocks({ ...split, scheduleDate: null })).toEqual([]);
    expect(lastBlockDay({ ...split, scheduleDate: null })).toBeNull();
    expect(lastBlockDay(split)).toBe('2026-11-25');
  });

  it('a máquina conflita bloco a bloco, só no dia de cada bloco', () => {
    const span = (
      taskId: string,
      date: string,
      start: number,
      minutes: number,
    ) => ({
      taskId,
      machine: 'Plotter',
      date,
      start,
      end: start + minutes,
      interval: 0,
    });
    // A dividida ocupa 08:00-12:00 nos dois dias. Às 13:00 do primeiro dia
    // a máquina está livre (antes ocupava 480 min, até 16:00); às 10:00 do
    // segundo, não
    const conflicts = machineConflicts([
      span('dividida', '2026-11-24', 480, 240),
      span('dividida', '2026-11-25', 480, 240),
      span('tarde', '2026-11-24', 780, 60),
      span('segundo-dia', '2026-11-25', 600, 60),
    ]);
    expect([...conflicts].sort()).toEqual(['dividida', 'segundo-dia']);
  });
});
