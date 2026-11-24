import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ProductionViewer } from './production-access.service';
import {
  NOT_TRIP_CREW,
  ProductionTripService,
} from './production-trip.service';

/** Veículos, fase 1 (Maicol, 23/11/2026, ELITE). */
const VIEWER = {
  companyId: 'c1',
  userId: 'u1',
  employeeId: 'e1',
  name: 'Ana',
  manager: true,
} as ProductionViewer;

const at = (h: number) => new Date(Date.UTC(2026, 10, 24, h));

const tripRow = (over: object = {}) => ({
  id: 't1',
  number: 7,
  companyId: 'c1',
  vehicleId: 'v1',
  driverId: 'e2',
  teamIds: [],
  departAt: at(8),
  returnAt: at(18),
  status: 'SCHEDULED',
  startedAt: null,
  finishedAt: null,
  odometerStart: null,
  odometerEnd: null,
  km: null,
  note: null,
  cancelReason: null,
  createdByName: 'Ana',
  closedByName: null,
  vehicle: { id: 'v1', name: 'Fiorino', plate: 'ABC1D23' },
  driver: { id: 'e2', name: 'João' },
  stops: [
    {
      id: 's1',
      kind: 'WORK',
      plannedKm: 50,
      status: 'PENDING',
      description: 'A',
    },
    {
      id: 's2',
      kind: 'WORK',
      plannedKm: 35,
      status: 'PENDING',
      description: 'B',
    },
    { id: 's3', kind: 'WORK', plannedKm: 15, status: 'DONE', description: 'C' },
    {
      id: 's4',
      kind: 'FREE',
      plannedKm: null,
      status: 'PENDING',
      description: 'Banco',
    },
  ],
  ...over,
});

const setup = () => {
  const prisma: any = {
    $transaction: jest.fn(async (fn) => fn(prisma)),
    $executeRaw: jest.fn(async () => 0),
    productionTrip: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(async ({ data }) => ({ id: 'new', ...data })),
    },
    productionTripStop: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    productionVehicle: {
      findFirst: jest.fn().mockResolvedValue({ id: 'v1', name: 'Fiorino' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    productionVehicleRequest: { findMany: jest.fn().mockResolvedValue([]) },
    productionTask: { findMany: jest.fn().mockResolvedValue([]) },
    employee: { findMany: jest.fn().mockResolvedValue([]) },
    productionAttachmentVersion: { count: jest.fn().mockResolvedValue(0) },
  };
  const access: any = {
    collaborator: jest.fn(async (_c, id) => ({ id, name: id })),
  };
  return { service: new ProductionTripService(prisma, access), prisma };
};

describe('ProductionTripService', () => {
  it('o veículo só sai de novo depois de fechar a saída anterior', async () => {
    const { service, prisma } = setup();
    prisma.productionTrip.findFirst
      .mockResolvedValueOnce(tripRow())
      .mockResolvedValueOnce({ number: 6, status: 'ON_ROUTE' });
    await expect(service.start(VIEWER, 't1', {}, true)).rejects.toThrow(
      new ConflictException(
        'Feche a saída 6 deste veículo antes: ela ainda está em rota',
      ),
    );
    expect(prisma.productionTrip.updateMany).not.toHaveBeenCalled();
  });

  it('"Saiu" e a parada: só o motorista, a equipe ou quem agenda', async () => {
    const { service, prisma } = setup();
    // Ana (e1) não dirige nem está na equipe da saída do João (e2)
    prisma.productionTrip.findFirst.mockResolvedValue(tripRow());
    await expect(service.start(VIEWER, 't1', {}, false)).rejects.toThrow(
      new ForbiddenException(NOT_TRIP_CREW),
    );
    prisma.productionTrip.findFirst.mockResolvedValue(
      tripRow({ status: 'ON_ROUTE' }),
    );
    await expect(
      service.stopResult(VIEWER, 't1', 's4', { status: 'DONE' }, false),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.productionTrip.updateMany).not.toHaveBeenCalled();
    expect(prisma.productionTripStop.updateMany).not.toHaveBeenCalled();

    // O motorista e quem está na equipe marcam
    prisma.productionTrip.findFirst.mockReset();
    prisma.productionTrip.findFirst
      .mockResolvedValueOnce(tripRow())
      .mockResolvedValueOnce(null)
      .mockResolvedValue(tripRow({ status: 'ON_ROUTE' }));
    await service.start({ ...VIEWER, employeeId: 'e2' }, 't1', {}, false);
    expect(prisma.productionTrip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1', companyId: 'c1', status: 'SCHEDULED' },
      }),
    );
    prisma.productionTrip.findFirst.mockResolvedValue(
      tripRow({ status: 'ON_ROUTE', teamIds: ['e1'] }),
    );
    await service.stopResult(VIEWER, 't1', 's4', { status: 'DONE' }, false);
    expect(prisma.productionTripStop.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 's4',
          tripId: 't1',
          status: 'PENDING',
          trip: { status: 'ON_ROUTE' },
        },
      }),
    );
  });

  it('a parada se conclui uma vez, com a saída em rota', async () => {
    const { service, prisma } = setup();
    // A saída ainda não saiu
    prisma.productionTrip.findFirst.mockResolvedValue(tripRow());
    await expect(
      service.stopResult(VIEWER, 't1', 's4', { status: 'DONE' }, true),
    ).rejects.toThrow('Marque "Saiu" antes de concluir uma parada');
    // A parada já feita
    prisma.productionTrip.findFirst.mockResolvedValue(
      tripRow({ status: 'ON_ROUTE' }),
    );
    await expect(
      service.stopResult(VIEWER, 't1', 's3', { status: 'NOT_DONE' }, true),
    ).rejects.toThrow('Esta parada já foi concluída');
    // Concluída por outro no meio tempo
    prisma.productionTripStop.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.stopResult(VIEWER, 't1', 's4', { status: 'DONE' }, true),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('fechar reparte o km pelo previsto e pede o resultado das paradas abertas', async () => {
    const { service, prisma } = setup();
    prisma.productionTrip.findFirst.mockResolvedValue(
      tripRow({ status: 'ON_ROUTE', odometerStart: 1000 }),
    );
    await expect(
      service.close(VIEWER, 't1', { odometerEnd: 1130 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.close(VIEWER, 't1', {
      odometerEnd: 1130,
      stops: [
        { stopId: 's1', status: 'DONE' },
        { stopId: 's2', status: 'NOT_DONE', reason: 'cliente ausente' },
        { stopId: 's4', status: 'DONE' },
      ],
    });
    const kms = Object.fromEntries(
      prisma.productionTripStop.update.mock.calls.map(([arg]) => [
        arg.where.id,
        arg.data.km,
      ]),
    );
    expect(kms).toEqual({ s1: 65, s2: 45.5, s3: 19.5, s4: 0 });
    expect(prisma.productionTrip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['SCHEDULED', 'ON_ROUTE'] },
        }),
        data: expect.objectContaining({ status: 'DONE', km: 130 }),
      }),
    );
  });

  it('o odômetro da volta menor que o da saída tem o aviso próprio', async () => {
    const { service, prisma } = setup();
    prisma.productionTrip.findFirst.mockResolvedValue(
      tripRow({ status: 'ON_ROUTE', odometerStart: 1000 }),
    );
    await expect(
      service.close(VIEWER, 't1', { odometerEnd: 990 }),
    ).rejects.toThrow('O odômetro da volta é menor que o da saída');
  });

  it('o km ajustado à mão: só paradas de trabalho da saída e a soma no rodado', async () => {
    const { service, prisma } = setup();
    prisma.productionTrip.findFirst.mockResolvedValue(
      tripRow({ status: 'ON_ROUTE', odometerStart: 1000 }),
    );
    const stops = [
      { stopId: 's1', status: 'DONE' as const },
      { stopId: 's2', status: 'DONE' as const },
      { stopId: 's4', status: 'DONE' as const },
    ];
    const close = (allocations: { stopId: string; km: number }[]) =>
      service.close(VIEWER, 't1', { odometerEnd: 1130, stops, allocations });
    // A parada livre não leva km
    await expect(
      close([
        { stopId: 's1', km: 100 },
        { stopId: 's4', km: 30 },
      ]),
    ).rejects.toThrow(
      'O km se reparte só entre as paradas de trabalho desta saída',
    );
    // A parada de outra saída
    await expect(close([{ stopId: 'outra', km: 130 }])).rejects.toThrow(
      BadRequestException,
    );
    // A soma não fecha no rodado
    await expect(
      close([
        { stopId: 's1', km: 60 },
        { stopId: 's2', km: 40 },
      ]),
    ).rejects.toThrow('precisa fechar no km rodado');
    expect(prisma.productionTrip.updateMany).not.toHaveBeenCalled();

    // Dentro da folga de 0,1 km
    await close([
      { stopId: 's1', km: 80 },
      { stopId: 's2', km: 30 },
      { stopId: 's3', km: 19.96 },
    ]);
    const kms = Object.fromEntries(
      prisma.productionTripStop.update.mock.calls.map(([arg]) => [
        arg.where.id,
        arg.data.km,
      ]),
    );
    expect(kms).toEqual({ s1: 80, s2: 30, s3: 20, s4: 0 });
  });

  it('não agenda o veículo que já tem saída no horário', async () => {
    const { service, prisma } = setup();
    prisma.productionTrip.findMany.mockResolvedValue([
      {
        id: 'x',
        vehicleId: 'v1',
        driverId: null,
        teamIds: [],
        departAt: at(9),
        returnAt: at(11),
        status: 'SCHEDULED',
      },
    ]);
    await expect(
      service.create(VIEWER, {
        vehicleId: 'v1',
        departAt: at(10).toISOString(),
        returnAt: at(12).toISOString(),
        stops: [{ kind: 'FREE', description: 'Banco' }],
      }),
    ).rejects.toThrow('Fiorino já tem uma saída nesse horário');
    // O conflito é conferido depois da trava do número, na transação
    expect(prisma.$executeRaw.mock.calls[0].slice(1).join('')).toBe(
      'numbering:production_trips:c1',
    );
    expect(prisma.productionTrip.create).not.toHaveBeenCalled();
  });

  it('o número da saída sai depois da trava', async () => {
    const { service, prisma } = setup();
    prisma.productionTrip.findFirst
      .mockResolvedValueOnce({ number: 7 })
      .mockResolvedValue(tripRow({ id: 'new', number: 8 }));
    await service.create(VIEWER, {
      vehicleId: 'v1',
      departAt: at(10).toISOString(),
      returnAt: at(12).toISOString(),
      stops: [{ kind: 'FREE', description: 'Banco' }],
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.productionTrip.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ number: 8 }) }),
    );
    const order = [
      prisma.$executeRaw.mock.invocationCallOrder[0],
      prisma.productionTrip.findMany.mock.invocationCallOrder[0],
      prisma.productionTrip.create.mock.invocationCallOrder[0],
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('o overview traz as pessoas ativas (motorista e equipe)', async () => {
    const { service, prisma } = setup();
    prisma.employee.findMany.mockResolvedValue([
      {
        id: 'e2',
        name: 'João',
        isActive: true,
        userId: 'u2',
        user: { name: 'João', isActive: true },
      },
      {
        id: 'e1',
        name: '',
        isActive: true,
        userId: 'u1',
        user: { name: 'Ana', isActive: true },
      },
      // Desligado, sem usuário, ou com o usuário inativo: fora da lista
      {
        id: 'e3',
        name: 'Rui',
        isActive: false,
        userId: 'u3',
        user: { name: 'Rui', isActive: true },
      },
      { id: 'e4', name: 'Sem login', isActive: true, userId: null, user: null },
      {
        id: 'e5',
        name: 'Bia',
        isActive: true,
        userId: 'u5',
        user: { name: 'Bia', isActive: false },
      },
    ]);
    const result = await service.overview(VIEWER, '2026-11-24', '2026-11-30');
    expect(result.people).toEqual([
      { id: 'e1', name: 'Ana' },
      { id: 'e2', name: 'João' },
    ]);
  });

  it('a parada de trabalho concluída no caminho pede a foto', async () => {
    const { service, prisma } = setup();
    prisma.productionTrip.findFirst.mockResolvedValue(
      tripRow({
        status: 'ON_ROUTE',
        startedAt: at(8),
        stops: [
          {
            id: 's1',
            kind: 'WORK',
            taskId: 'task1',
            status: 'PENDING',
            description: 'A',
          },
        ],
      }),
    );
    await expect(
      service.stopResult(VIEWER, 't1', 's1', { status: 'DONE' }, true),
    ).rejects.toThrow('Tire a foto do trabalho pronto antes de concluir');
    prisma.productionAttachmentVersion.count.mockResolvedValue(1);
    await service.stopResult(VIEWER, 't1', 's1', { status: 'DONE' }, true);
    expect(prisma.productionTripStop.updateMany).toHaveBeenCalled();
  });
});
