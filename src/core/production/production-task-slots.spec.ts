import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductionViewer } from './production-access.service';
import { ProductionTaskService } from './production-task.service';

/** Os blocos de agenda da tarefa (GP-52; Maicol, 23/11/2026, ELITE). */
const VIEWER = {
  companyId: 'c1',
  userId: 'u1',
  employeeId: 'e1',
  name: 'Ana',
  manager: true,
} as ProductionViewer;

const setup = () => {
  const prisma = {
    $transaction: jest.fn(),
    productionTask: {
      findUnique: jest.fn().mockResolvedValue({
        scheduleDate: new Date('2026-11-24T00:00:00Z'),
        scheduleMinutes: 360,
        estimatedMinutes: 360,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    productionTaskSlot: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    productionTaskHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const service = new ProductionTaskService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  Object.assign(service, {
    load: jest.fn().mockResolvedValue({}),
    respond: jest.fn(async (_v, _id, message) => ({ message })),
  });
  return { service, prisma };
};

describe('ProductionTaskService: blocos de agenda (GP-52)', () => {
  it('dividir em dois dias deixa o escolhido no primeiro e o resto num bloco novo', async () => {
    const { service, prisma } = setup();
    const res = await service.split(VIEWER, 't1', {
      date: '2026-11-25',
      start: '08:00',
      keepMinutes: 180,
    });
    expect(prisma.productionTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { scheduleMinutes: 180 },
    });
    expect(prisma.productionTaskSlot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 't1',
        minutes: 180,
        kind: 'NORMAL',
        start: '08:00',
      }),
    });
    expect(res).toEqual({
      message: 'Dividiu em dois dias: 3h no primeiro e 3h em 25/11/2026',
    });
  });

  it('não divide sem agenda nem deixando tudo no primeiro dia', async () => {
    const { service, prisma } = setup();
    await expect(
      service.split(VIEWER, 't1', { date: '2026-11-25', keepMinutes: 360 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.productionTask.findUnique.mockResolvedValue({
      scheduleDate: null,
      scheduleMinutes: null,
      estimatedMinutes: 360,
    });
    await expect(
      service.split(VIEWER, 't1', { date: '2026-11-25', keepMinutes: 60 }),
    ).rejects.toThrow('Agende a tarefa antes de dividir');
  });

  it('o tempo extra pede o motivo', async () => {
    const { service, prisma } = setup();
    await expect(
      service.addSlot(VIEWER, 't1', {
        date: '2026-11-25',
        minutes: 60,
        kind: 'EXTRA',
      }),
    ).rejects.toThrow('Diga o motivo do tempo extra');
    await service.addSlot(VIEWER, 't1', {
      date: '2026-11-25',
      minutes: 60,
      kind: 'EXTRA',
      reason: 'retrabalho',
    });
    expect(prisma.productionTaskSlot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'EXTRA', reason: 'retrabalho' }),
    });
  });

  it('tirar o bloco do resto devolve os minutos ao primeiro dia', async () => {
    const { service, prisma } = setup();
    prisma.productionTaskSlot.findFirst.mockResolvedValue({
      id: 'sl1',
      kind: 'NORMAL',
      minutes: 120,
    });
    await service.removeSlot(VIEWER, 't1', 'sl1');
    expect(prisma.productionTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { scheduleMinutes: 480 },
    });
    expect(prisma.productionTaskSlot.delete).toHaveBeenCalledWith({
      where: { id: 'sl1' },
    });

    prisma.productionTaskSlot.findFirst.mockResolvedValue(null);
    await expect(
      service.removeSlot(VIEWER, 't1', 'sl9'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
