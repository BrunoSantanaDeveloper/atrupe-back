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
      productionItemStage: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    prisma.deliverySchedule.findMany = jest.fn().mockResolvedValue([]);
    prisma.productionStage.updateMany = jest.fn();
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

  describe('etapas por item na agenda (§4.7)', () => {
    it('trocar a etapa do item recalcula a etapa do pedido no setor', async () => {
      prisma.productionItemStage.findFirst.mockResolvedValue({
        id: 'it-1',
        scheduleId: 'sch-1',
        stageId: 'sec-imp',
        status: 'NOT_STARTED',
      });
      prisma.productionItemStage.findMany.mockResolvedValue([
        { status: 'DONE' },
        { status: 'NOT_STARTED' },
      ]);
      prisma.productionStage.findFirst.mockResolvedValue({
        id: 'st-imp',
        status: 'NOT_STARTED',
      });

      await service.updateItem('it-1', { status: 'DONE' } as any, 'c-1');

      expect(prisma.productionItemStage.findFirst).toHaveBeenCalledWith({
        where: { id: 'it-1', schedule: scheduleOfCompany },
      });
      expect(prisma.productionItemStage.update).toHaveBeenCalledWith({
        where: { id: 'it-1' },
        data: { status: 'DONE', prevStatus: 'NOT_STARTED' },
      });
      // Um item pronto e outro por começar: o setor está em andamento
      expect(prisma.productionStage.update).toHaveBeenCalledWith({
        where: { id: 'st-imp' },
        data: { status: 'IN_PROGRESS', prevStatus: 'NOT_STARTED' },
      });
    });

    it('a etapa do item de outra empresa responde 404', async () => {
      prisma.productionItemStage.findFirst.mockResolvedValue(null);
      await expect(
        service.updateItem('it-9', { status: 'DONE' } as any, 'c-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a venda que segue o gerenciador não troca a etapa do item', async () => {
      prisma.productionItemStage.findFirst.mockResolvedValue({
        id: 'it-1',
        scheduleId: 'sch-1',
        stageId: 'sec-imp',
        status: 'NOT_STARTED',
      });
      prisma.productionProject.count.mockResolvedValue(1);
      await expect(
        service.updateItem('it-1', { status: 'DONE' } as any, 'c-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.productionItemStage.update).not.toHaveBeenCalled();
    });

    it('concluir pelo pedido conclui o setor nos itens abertos', async () => {
      prisma.productionStage.findFirst
        .mockResolvedValueOnce({
          id: 'st-imp',
          scheduleId: 'sch-1',
          stageId: 'sec-imp',
          status: 'IN_PROGRESS',
        })
        .mockResolvedValueOnce({ id: 'st-imp', status: 'DONE' });
      prisma.productionItemStage.findMany
        .mockResolvedValueOnce([
          { id: 'a', status: 'DONE' },
          { id: 'b', status: 'IN_PROGRESS' },
          { id: 'c', status: 'NOT_STARTED' },
        ])
        .mockResolvedValueOnce([
          { status: 'DONE' },
          { status: 'DONE' },
          { status: 'DONE' },
        ]);

      await service.update('st-imp', { status: 'DONE' } as any, 'c-1');

      const updated = prisma.productionItemStage.update.mock.calls.map(
        ([arg]) => arg.where.id,
      );
      expect(updated).toEqual(['b', 'c']);
    });

    it('concluir tudo finaliza as etapas das agendas da empresa, fora a entrega', async () => {
      prisma.deliverySchedule.findMany.mockResolvedValue([{ id: 'sch-1' }]);

      const result = await service.finishAll(['sch-1', 'sch-x'], 'c-1');

      expect(prisma.deliverySchedule.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['sch-1', 'sch-x'] }, ...scheduleOfCompany },
        select: { id: true },
      });
      expect(prisma.productionItemStage.updateMany).toHaveBeenCalledWith({
        where: { scheduleId: 'sch-1', status: { notIn: ['DONE', 'CANCELED'] } },
        data: { status: 'DONE' },
      });
      expect(prisma.productionStage.updateMany).toHaveBeenCalledWith({
        where: {
          scheduleId: 'sch-1',
          status: { notIn: ['DONE', 'CANCELED'] },
          OR: [
            { stageId: null },
            { stage: { name: { notIn: ['Entrega', 'Cliente Retira'] } } },
          ],
        },
        data: { status: 'DONE' },
      });
      expect(result).toEqual({ finished: 1, skipped: 0, notFound: 1 });
    });
  });
});
