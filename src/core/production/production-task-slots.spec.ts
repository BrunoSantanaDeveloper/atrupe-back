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

/** A recusa com 400 e a mensagem exata. */
const badRequest = (promise: Promise<unknown>, message: string) =>
  promise.then(
    () => {
      throw new Error(`devia recusar: ${message}`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(message);
    },
  );

const setup = () => {
  const prisma = {
    $transaction: jest.fn(),
    productionTask: {
      findUnique: jest.fn().mockResolvedValue({
        scheduleDate: new Date('2026-11-24T00:00:00Z'),
        scheduleMinutes: 360,
        estimatedMinutes: 360,
        status: 'NOT_STARTED',
      }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    productionTaskSlot: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    productionTimeEntry: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'en-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    productionTimeCorrection: { create: jest.fn().mockResolvedValue({}) },
    productionTaskStep: { findMany: jest.fn().mockResolvedValue([]) },
    assetCost: { findMany: jest.fn().mockResolvedValue([]) },
    productionTaskHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const access = {
    collaborator: jest.fn().mockResolvedValue({ id: 'e2', name: 'Bia' }),
  };
  const mirror = { sync: jest.fn().mockResolvedValue(undefined) };
  const service = new ProductionTaskService(
    prisma as never,
    access as never,
    {} as never,
    mirror as never,
    {} as never,
    {} as never,
    { after: jest.fn() } as never,
  );
  Object.assign(service, {
    load: jest.fn().mockResolvedValue({}),
    respond: jest.fn(async (_v, _id, message) => ({ message })),
  });
  return { service, prisma, mirror };
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

  it('data que não existe dá 400, e não erro do banco', async () => {
    const { service, prisma } = setup();
    for (const date of ['2026-13-45', '2026-02-30']) {
      await badRequest(
        service.addSlot(VIEWER, 't1', { date, minutes: 60, kind: 'NORMAL' }),
        'Data inválida',
      );
      await badRequest(
        service.split(VIEWER, 't1', { date, keepMinutes: 60 }),
        'Data inválida',
      );
      await badRequest(
        service.schedule(VIEWER, 't1', { schedule: { date } }),
        'Data inválida',
      );
    }
    expect(prisma.productionTaskSlot.create).not.toHaveBeenCalled();
    expect(prisma.productionTask.update).not.toHaveBeenCalled();
  });

  it('o bloco pede a agenda, uma hora válida e não fica antes do bloco 1', async () => {
    const { service, prisma } = setup();
    await badRequest(
      service.addSlot(VIEWER, 't1', {
        date: '2026-11-25',
        start: '25:00',
        minutes: 60,
        kind: 'NORMAL',
      }),
      'Hora inválida',
    );
    await badRequest(
      service.addSlot(VIEWER, 't1', {
        date: '2026-11-23',
        minutes: 60,
        kind: 'NORMAL',
      }),
      'O bloco vai no dia do primeiro (24/11/2026) ou depois dele',
    );
    await badRequest(
      service.split(VIEWER, 't1', { date: '2026-11-24', keepMinutes: 60 }),
      'O resto vai para um dia depois do primeiro (24/11/2026)',
    );
    prisma.productionTask.findUnique.mockResolvedValue({
      scheduleDate: null,
      scheduleMinutes: null,
      estimatedMinutes: 360,
    });
    await badRequest(
      service.addSlot(VIEWER, 't1', {
        date: '2026-11-25',
        minutes: 60,
        kind: 'EXTRA',
        reason: 'retrabalho',
      }),
      'Agende a tarefa antes de acrescentar tempo',
    );
    expect(prisma.productionTaskSlot.create).not.toHaveBeenCalled();
  });

  it('tirar da agenda tira os outros blocos junto', async () => {
    const { service, prisma } = setup();
    prisma.productionTaskSlot.deleteMany.mockResolvedValue({ count: 2 });
    const res = await service.schedule(VIEWER, 't1', { schedule: null });
    expect(prisma.productionTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { scheduleDate: null, scheduleStart: null, scheduleMinutes: null },
    });
    expect(prisma.productionTaskSlot.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 't1' },
    });
    expect(res).toEqual({
      message: 'Tirou da agenda, com os outros 2 blocos',
    });
  });

  it('reagendar o bloco 1 para depois de outro bloco é recusado com o dia dele', async () => {
    const { service, prisma } = setup();
    prisma.productionTaskSlot.findMany.mockResolvedValue([
      { date: new Date('2026-11-25T00:00:00Z') },
    ]);
    await badRequest(
      service.schedule(VIEWER, 't1', { schedule: { date: '2026-11-26' } }),
      'O bloco de 25/11/2026 ficaria antes do primeiro dia. Agende até 25/11/2026 ou tire esse bloco antes (o resto de um trabalho dividido volta ao primeiro dia).',
    );
    expect(prisma.productionTaskSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: 't1',
          date: { lt: new Date('2026-11-26T00:00:00Z') },
        },
      }),
    );
    expect(prisma.productionTask.update).not.toHaveBeenCalled();

    // No dia do bloco ou antes, os blocos continuam depois do primeiro
    prisma.productionTaskSlot.findMany.mockResolvedValue([]);
    await service.schedule(VIEWER, 't1', { schedule: { date: '2026-11-25' } });
    expect(prisma.productionTask.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        scheduleDate: new Date('2026-11-25T00:00:00Z'),
        scheduleStart: null,
        scheduleMinutes: null,
      },
    });
  });

  describe('o relógio', () => {
    afterEach(() => jest.useRealTimers());

    it('às 22h de Brasília cai no bloco de hoje, e não no de amanhã (UTC)', async () => {
      // 24/11 às 22:00 em Brasília = 25/11 às 01:00 em UTC
      jest.useFakeTimers({
        now: new Date('2026-11-25T01:00:00Z'),
        doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
      });
      const { service, prisma } = setup();
      Object.assign(service, {
        load: jest.fn().mockResolvedValue({
          ctx: {
            chain: {
              task: () => ({}),
              blocking: () => ({ blocked: false, blockedBy: null }),
            },
            types: new Map([['tt', { timeControl: true }]]),
          },
          row: { status: 'NOT_STARTED', taskTypeId: 'tt' },
          project: { status: 'PRODUCTION' },
        }),
        workTarget: jest
          .fn()
          .mockResolvedValue({ id: 'e1', name: 'Ana', hasAccess: true }),
      });
      prisma.productionTaskSlot.findFirst.mockResolvedValue({ id: 'sl-hoje' });

      await service.workStart(VIEWER, 't1', { collaboratorId: 'e1' });

      expect(prisma.productionTaskSlot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 't1', date: new Date('2026-11-24T00:00:00Z') },
        }),
      );
      expect(prisma.productionTimeEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ slotId: 'sl-hoje', employeeId: 'e1' }),
      });
    });
  });

  it('a correção respeita o bloco escolhido, e sem ele fica onde estava', async () => {
    const { service, prisma } = setup();
    const editor = { ...VIEWER, timeEditor: true } as ProductionViewer;
    prisma.productionTimeEntry.findFirst.mockResolvedValue({
      id: 'en-1',
      employeeId: 'e1',
      end: new Date('2026-11-24T12:00:00Z'),
      seconds: 1800,
      slotId: null,
    });
    prisma.productionTaskSlot.findFirst.mockResolvedValue({ id: 'sl-2' });
    await service.correctEntry(editor, 't1', 'en-1', {
      minutes: 25,
      collaboratorId: 'e2',
      note: 'era no segundo dia',
      slotId: 'sl-2',
    });
    expect(prisma.productionTaskSlot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sl-2', taskId: 't1' } }),
    );
    expect(prisma.productionTimeEntry.update).toHaveBeenCalledWith({
      where: { id: 'en-1' },
      data: expect.objectContaining({ seconds: 1500, slotId: 'sl-2' }),
    });
    expect(prisma.productionTimeCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        before: { collaboratorId: 'e1', minutes: 30, slotId: null },
        after: { collaboratorId: 'e2', minutes: 25, slotId: 'sl-2' },
      }),
    });

    // Sem o slotId, o trecho fica no bloco em que estava
    prisma.productionTimeEntry.findFirst.mockResolvedValue({
      id: 'en-1',
      employeeId: 'e2',
      end: new Date('2026-11-24T12:00:00Z'),
      seconds: 1500,
      slotId: 'sl-2',
    });
    await service.correctEntry(editor, 't1', 'en-1', {
      minutes: 20,
      collaboratorId: 'e2',
      note: 'acerto',
    });
    expect(prisma.productionTimeEntry.update).toHaveBeenLastCalledWith({
      where: { id: 'en-1' },
      data: expect.objectContaining({ seconds: 1200, slotId: 'sl-2' }),
    });

    // O bloco de outra tarefa é recusado
    prisma.productionTaskSlot.findFirst.mockResolvedValue(null);
    await badRequest(
      service.correctEntry(editor, 't1', 'en-1', {
        minutes: 20,
        collaboratorId: 'e2',
        note: 'acerto',
        slotId: 'sl-de-outra',
      }),
      'Bloco não encontrado',
    );
  });

  it('depois de começar, os blocos não se juntam mais', async () => {
    const { service, prisma } = setup();
    prisma.productionTaskSlot.findFirst.mockResolvedValue({
      id: 'sl1',
      kind: 'NORMAL',
      minutes: 120,
    });
    prisma.productionTask.findUnique.mockResolvedValue({
      status: 'IN_PROGRESS',
    });
    await expect(service.removeSlot(VIEWER, 't1', 'sl1')).rejects.toThrow(
      'já começou',
    );
  });
});
