import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductionViewer } from './production-access.service';
import { ProductionTripService } from './production-trip.service';

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
    productionTrip: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    productionTripStop: { update: jest.fn() },
    productionVehicle: {
      findFirst: jest.fn().mockResolvedValue({ id: 'v1', name: 'Fiorino' }),
    },
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
    await expect(service.start(VIEWER, 't1', {})).rejects.toThrow(
      new ConflictException(
        'Feche a saída 6 deste veículo antes: ela ainda está em rota',
      ),
    );
    expect(prisma.productionTrip.update).not.toHaveBeenCalled();
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
    expect(prisma.productionTrip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DONE', km: 130 }),
      }),
    );
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
      service.stopResult(VIEWER, 't1', 's1', { status: 'DONE' }),
    ).rejects.toThrow('Tire a foto do trabalho pronto antes de concluir');
    prisma.productionAttachmentVersion.count.mockResolvedValue(1);
    await service.stopResult(VIEWER, 't1', 's1', { status: 'DONE' });
    expect(prisma.productionTripStop.update).toHaveBeenCalled();
  });
});
