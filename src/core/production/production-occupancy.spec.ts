import { BadRequestException } from '@nestjs/common';
import {
  ProductionOccupancyService,
  occupancyOf,
} from './production-occupancy.service';

describe('o mapa de ocupação (GP-50)', () => {
  const steps = [
    { id: 's1', taskTypeId: 't-imp', managerId: 'm-imp' },
    { id: 's2', taskTypeId: 't-imp', managerId: 'm-acab' },
  ];
  const task = (over: Partial<Parameters<typeof occupancyOf>[0][0]>) => ({
    scheduleDate: new Date('2026-11-24T00:00:00Z'),
    scheduleMinutes: null,
    estimatedMinutes: 60,
    setupMinutes: 0,
    currentStepId: null,
    taskTypeId: 't-imp',
    ...over,
  });

  it('soma por gerenciador e por dia, na etapa em que a tarefa está', () => {
    expect(
      occupancyOf(
        [
          task({}),
          task({ estimatedMinutes: 30, scheduleMinutes: 90 }),
          task({ currentStepId: 's2', estimatedMinutes: 45 }),
          task({ scheduleDate: new Date('2026-11-25T00:00:00Z') }),
          task({ scheduleDate: null }),
        ],
        steps,
      ),
    ).toEqual([
      { managerId: 'm-acab', date: '2026-11-24', minutes: 45, tasks: 1 },
      { managerId: 'm-imp', date: '2026-11-24', minutes: 150, tasks: 2 },
      { managerId: 'm-imp', date: '2026-11-25', minutes: 60, tasks: 1 },
    ]);
  });

  it('a tarefa dividida conta em cada dia só o bloco dele, e a soma dá o total (GP-52)', () => {
    // 480 min divididos em 240 + 240: o split grava 240 no bloco 1
    const days = occupancyOf(
      [
        task({
          estimatedMinutes: 480,
          scheduleMinutes: 240,
          slots: [
            {
              id: 'sl-2',
              date: new Date('2026-11-25T00:00:00Z'),
              start: null,
              minutes: 240,
              kind: 'NORMAL',
            },
          ],
        }),
      ],
      steps,
    );
    expect(days).toEqual([
      { managerId: 'm-imp', date: '2026-11-24', minutes: 240, tasks: 1 },
      { managerId: 'm-imp', date: '2026-11-25', minutes: 240, tasks: 1 },
    ]);
    expect(days.reduce((sum, row) => sum + row.minutes, 0)).toBe(480);
  });

  it('só os dias do período, e o bloco de tarefa fora da agenda não conta', () => {
    const slots = [
      {
        id: 'sl-2',
        date: new Date('2026-11-26T00:00:00Z'),
        start: null,
        minutes: 60,
        kind: 'EXTRA' as const,
      },
    ];
    expect(
      occupancyOf(
        [
          task({ slots }),
          task({ scheduleDate: null, slots: [{ ...slots[0], id: 'sl-9' }] }),
        ],
        steps,
        { from: '2026-11-25', to: '2026-11-30' },
      ),
    ).toEqual([
      { managerId: 'm-imp', date: '2026-11-26', minutes: 60, tasks: 1 },
    ]);
  });

  it('recusa período inválido ou longo demais', async () => {
    const service = new ProductionOccupancyService({} as never, {} as never);
    await expect(
      service.occupancy('c-1', '2026-11-30', '2026-11-24'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.occupancy('c-1', '2026-01-01', '2026-12-31'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
