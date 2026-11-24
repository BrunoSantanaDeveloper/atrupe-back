import { ProductionChain } from './engine/production-chain';
import { ProductionViewer } from './production-access.service';
import { ProductionBoardService } from './production-board.service';
import {
  ProductionContext,
  ProductionViewService,
  productionClock,
} from './production-view.service';

/**
 * A fila e a agenda com os blocos de agenda (GP-52): a tarefa aparece no
 * dia de cada bloco, com os minutos dele, e a máquina fica ocupada bloco a
 * bloco.
 */
const VIEWER = {
  companyId: 'c1',
  userId: 'u1',
  employeeId: 'e1',
  name: 'Ana',
  manager: true,
  allSectors: true,
  access: new Set<string>(),
} as unknown as ProductionViewer;

const day = (date: string) => new Date(`${date}T00:00:00Z`);

const row = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  projectId: 'p1',
  stageName: 'Impressão',
  status: 'NOT_STARTED',
  estimatedMinutes: 60,
  dependsOn: [],
  releasedNext: null,
  scheduleDate: day('2026-11-24'),
  scheduleStart: '08:00',
  scheduleMinutes: 60,
  assigneeId: null,
  currentStepId: 'st1',
  taskTypeId: 'tt',
  sectorId: 's1',
  slots: [],
  timeEntries: [],
  corrections: [],
  ...patch,
});

// A dividida: 480 min em 240 no dia 24 e 240 no dia 25, às 08:00
const split = row('dividida', {
  estimatedMinutes: 480,
  scheduleMinutes: 240,
  slots: [
    {
      id: 'sl-2',
      date: day('2026-11-25'),
      start: '08:00',
      minutes: 240,
      kind: 'NORMAL',
    },
  ],
});

const agendaOf = (rows: ReturnType<typeof row>[]) => {
  const ctx = {
    rows,
    managers: new Map([
      ['m1', { id: 'm1', isActive: true, intervalMinutes: 0 }],
    ]),
  } as unknown as ProductionContext;
  const view = {
    context: jest.fn().mockResolvedValue(ctx),
    visible: () => true,
    views: jest.fn(async (_ctx, ids: string[]) => ids.map((id) => ({ id }))),
    stepOf: () => ({ managerId: 'm1' }),
    managerSummaryView: (manager: { id: string }) => ({ id: manager.id }),
  };
  const prisma = {
    productionTask: {
      findMany: jest.fn().mockResolvedValue(
        rows.map((item) => ({
          id: item.id,
          setupMinutes: 0,
          estimatedMinutes: item.estimatedMinutes,
          machine: 'Plotter',
          vehicleId: null,
          km: null,
        })),
      ),
    },
    productionVehicle: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return new ProductionBoardService(
    prisma as never,
    {} as never,
    view as never,
  );
};

describe('a agenda da fila com os blocos (GP-52)', () => {
  it('a tarefa aparece no dia do bloco 2, mesmo com o bloco 1 fora do período', async () => {
    const service = agendaOf([
      split,
      row('outra', { scheduleDate: day('2026-11-26') }),
    ]);
    const res = await service.agenda(VIEWER, {
      from: '2026-11-25',
      to: '2026-11-25',
    });
    expect(res.scheduled.map((task) => task.id)).toEqual(['dividida']);
  });

  it('a máquina fica ocupada só com os minutos do bloco, no dia dele', async () => {
    // Dia 24: a dividida vai das 08:00 às 12:00; a das 13:00 não conflita
    // (antes, a dividida ocupava os 480 min no primeiro dia, até 16:00)
    const afternoon = row('tarde', { scheduleStart: '13:00' });
    // Dia 25: o bloco 2 vai das 08:00 às 12:00; a das 10:00 conflita
    const second = row('segundo-dia', {
      scheduleDate: day('2026-11-25'),
      scheduleStart: '10:00',
    });
    const service = agendaOf([split, afternoon, second]);

    const first = await service.agenda(VIEWER, {
      from: '2026-11-24',
      to: '2026-11-24',
    });
    expect(first.scheduled.map((task) => [task.id, task.conflict])).toEqual([
      ['dividida', false],
      ['tarde', false],
    ]);

    const both = await service.agenda(VIEWER, {
      from: '2026-11-24',
      to: '2026-11-25',
    });
    expect(
      Object.fromEntries(
        both.scheduled.map((task) => [task.id, task.conflict]),
      ),
    ).toEqual({ dividida: true, tarde: false, 'segundo-dia': true });
  });
});

describe('a TaskView com os blocos (GP-52)', () => {
  it('traz os slots e os blocos, o bloco 1 primeiro, com os minutos de cada um', async () => {
    const detail = {
      ...split,
      code: 'C1',
      quotationProductId: 'qp1',
      itemName: 'Banner',
      itemImage: null,
      sectorName: 'Impressão',
      setupMinutes: 0,
      machine: 'Plotter',
      machineSetupId: null,
      machineQuality: null,
      baseTaskId: null,
      quantity: 1,
      measureText: '',
      fields: [],
      consumption: [],
      note: null,
      pendencyText: null,
      completedBy: null,
      completedAt: null,
      vehicleId: null,
      km: null,
      priority: 'NORMAL',
      slots: [
        {
          ...split.slots[0],
          reason: null,
          byName: 'Ana',
        },
      ],
      attachments: [],
      history: [],
    };
    const prisma = {
      productionTask: { findMany: jest.fn().mockResolvedValue([detail]) },
    };
    const service = new ProductionViewService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const chainRow = split as never;
    const chain = new ProductionChain(
      [service.chainTask(chainRow)],
      new Map([
        [
          'p1',
          {
            id: 'p1',
            status: 'PRODUCTION' as const,
            due: '2026-11-30',
          },
        ],
      ]),
      // 24/11 às 13:00 de Brasília
      productionClock(new Date('2026-11-24T16:00:00Z')),
    );
    const ctx = {
      viewer: VIEWER,
      chain,
      rows: [chainRow],
      rowsById: new Map([['dividida', chainRow]]),
      projects: new Map([
        [
          'p1',
          {
            id: 'p1',
            number: '10',
            quotationId: 'q1',
            clientName: 'Cliente',
            sellerName: 'Vendedor',
            approvedAt: new Date('2026-11-20T12:00:00Z'),
            deliveryType: 'RETIRADA',
            firstDue: day('2026-11-30'),
            due: day('2026-11-30'),
            status: 'PRODUCTION',
            quotation: null,
          },
        ],
      ]),
      types: new Map(),
      managers: new Map(),
      collaborators: new Map(),
    } as unknown as ProductionContext;

    const [view] = await service.views(ctx, ['dividida']);

    expect(view.schedule).toEqual({
      date: '2026-11-24',
      start: '08:00',
      minutes: 240,
    });
    expect(view.slots).toEqual([
      {
        id: 'sl-2',
        date: '2026-11-25',
        start: '08:00',
        minutes: 240,
        kind: 'NORMAL',
        reason: null,
        by: 'Ana',
      },
    ]);
    expect(
      view.blocks.map((block) => [block.slotId, block.date, block.minutes]),
    ).toEqual([
      [null, '2026-11-24', 240],
      ['sl-2', '2026-11-25', 240],
    ]);
    // Às 13:00 do dia 24 o bloco 1 (08:00 às 12:00) acabou, mas o bloco 2
    // é amanhã: a tarefa não passou do horário
    expect(view.alert).toBeNull();
  });
});
