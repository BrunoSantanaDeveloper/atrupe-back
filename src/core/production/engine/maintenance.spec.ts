import {
  addMonths,
  blocksTask,
  maintenanceBlocks,
  maintenanceSpans,
} from './maintenance';

const cost = {
  id: 'c1',
  name: 'Troca da cabeça',
  assetId: 'a-roland',
  machine: 'Plotter Roland',
  setupIds: ['s-alta', 's-normal'],
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

  it('o bloqueio leva o bem e as configurações dele', () => {
    const [block] = maintenanceBlocks([cost], '2026-11-01', '2026-11-30');
    expect(block).toMatchObject({
      assetId: 'a-roland',
      machine: 'Plotter Roland',
      setupIds: ['s-alta', 's-normal'],
    });
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

describe('blocksTask: a manutenção casa com a máquina da tarefa', () => {
  const [block] = maintenanceBlocks([cost], '2026-11-01', '2026-11-30');

  it('pela configuração vendida', () => {
    expect(
      blocksTask(block, {
        machine: 'Plotter Roland · Alta',
        machineSetupId: 's-alta',
      }),
    ).toBe(true);
    // A configuração de outro bem não casa, mesmo com o nome parecido
    expect(
      blocksTask(block, {
        machine: 'Plotter Roland · Alta',
        machineSetupId: 's-outro',
      }),
    ).toBe(false);
  });

  it('na tarefa antiga, pelo nome do bem ou pelo prefixo "Bem · "', () => {
    expect(blocksTask(block, { machine: 'Plotter Roland' })).toBe(true);
    expect(
      blocksTask(block, {
        machine: 'Plotter Roland · Alta',
        machineSetupId: null,
      }),
    ).toBe(true);
    expect(
      blocksTask(block, { machine: 'Plotter Roland · Alta · Brilho' }),
    ).toBe(true);
  });

  it('outro bem, o grupo de máquinas ou a tarefa sem máquina não casam', () => {
    expect(blocksTask(block, { machine: 'Plotter Roland 2' })).toBe(false);
    expect(blocksTask(block, { machine: 'Plotters de recorte' })).toBe(false);
    expect(blocksTask(block, { machine: null })).toBe(false);
  });

  it('maintenanceSpans: os períodos do dia, em minutos, só da máquina da tarefa', () => {
    const blocks = maintenanceBlocks(
      [
        cost,
        {
          ...cost,
          id: 'c2',
          assetId: 'a-hp',
          machine: 'HP Latex',
          setupIds: ['s-hp'],
        },
      ],
      '2026-11-01',
      '2026-11-30',
    );
    expect(
      maintenanceSpans(
        blocks,
        { machine: 'x', machineSetupId: 's-normal' },
        '2026-11-23',
      ),
    ).toEqual([{ name: 'Troca da cabeça', from: 14 * 60, to: 16 * 60 }]);
    expect(
      maintenanceSpans(
        blocks,
        { machine: 'x', machineSetupId: 's-normal' },
        '2026-11-24',
      ),
    ).toEqual([]);
  });
});
