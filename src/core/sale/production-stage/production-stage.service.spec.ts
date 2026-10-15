import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductionStageService } from './production-stage.service';

describe('ProductionStageService: etapas das agendas da empresa', () => {
  let prisma: any;
  let service: ProductionStageService;

  const scheduleOfCompany = {
    OR: [
      { companyId: 'c-1' },
      { quotation: { companyId: 'c-1' } },
      { order: { quotation: { companyId: 'c-1' } } },
    ],
  };

  beforeEach(() => {
    prisma = {
      productionStage: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      deliverySchedule: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      companySector: { count: jest.fn().mockResolvedValue(1) },
      productionProject: { count: jest.fn().mockResolvedValue(0) },
    };
    service = new ProductionStageService(prisma);
  });

  it('a lista só traz etapas de agendas da empresa', async () => {
    await service.findAll('c-1');
    expect(prisma.productionStage.findMany).toHaveBeenCalledWith({
      where: { schedule: scheduleOfCompany },
    });
  });

  it('alterar e apagar a etapa de outra empresa responde 404', async () => {
    prisma.productionStage.findFirst.mockResolvedValue(null);

    await expect(
      service.update('st-9', { status: 'DONE' } as any, 'c-1'),
    ).rejects.toThrow(
      new NotFoundException('Etapa de produção nao encontrada'),
    );
    await expect(service.remove('st-9', 'c-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.productionStage.findFirst).toHaveBeenCalledWith({
      where: { id: 'st-9', schedule: scheduleOfCompany },
    });
    expect(prisma.productionStage.update).not.toHaveBeenCalled();
    expect(prisma.productionStage.delete).not.toHaveBeenCalled();
  });

  it('o setor de outra empresa na etapa responde 404, sem gravar', async () => {
    prisma.productionStage.findFirst.mockResolvedValue({
      id: 'st-1',
      status: 'PENDING',
      scheduleId: 'ag-1',
    });
    prisma.companySector.count.mockResolvedValue(0);

    await expect(
      service.update('st-1', { stageId: 'setor-b' } as any, 'c-1'),
    ).rejects.toThrow(new NotFoundException('Setor não encontrado.'));
    expect(prisma.companySector.count).toHaveBeenCalledWith({
      where: { id: { in: ['setor-b'] }, companyId: 'c-1' },
    });
    expect(prisma.productionStage.update).not.toHaveBeenCalled();
  });

  it('alterar a etapa da empresa passa e recalcula a agenda dela', async () => {
    prisma.productionStage.findFirst.mockResolvedValue({
      id: 'st-1',
      status: 'PENDING',
      scheduleId: 'ag-1',
    });

    await service.update('st-1', { status: 'DONE' } as any, 'c-1');
    expect(prisma.productionStage.update).toHaveBeenCalledWith({
      where: { id: 'st-1' },
      data: { status: 'DONE', prevStatus: 'PENDING' },
    });
    expect(prisma.deliverySchedule.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ag-1' } }),
    );
  });

  it('recalcular a agenda de outra empresa pela rota responde 404', async () => {
    prisma.deliverySchedule.findFirst.mockResolvedValue(null);

    await expect(
      service.updateScheduleOfCompany('ag-9', 'c-1'),
    ).rejects.toThrow(
      new NotFoundException('Agenda de entrega não encontrada.'),
    );
    expect(prisma.deliverySchedule.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      'alterar',
      (s: ProductionStageService) =>
        s.update('st-1', { status: 'DONE' } as any, 'c-1'),
    ],
    ['apagar', (s: ProductionStageService) => s.remove('st-1', 'c-1')],
  ])(
    '%s a etapa espelhada do gerenciador (ELITE) responde 409',
    async (_label, act) => {
      prisma.productionStage.findFirst.mockResolvedValue({
        id: 'st-1',
        status: 'PENDING',
        scheduleId: 'ag-1',
      });
      prisma.productionProject.count.mockResolvedValue(1);

      await expect(act(service)).rejects.toThrow(
        new ConflictException(
          'As etapas desta venda seguem o gerenciador de produção',
        ),
      );
      expect(prisma.productionStage.update).not.toHaveBeenCalled();
      expect(prisma.productionStage.delete).not.toHaveBeenCalled();
    },
  );
});
