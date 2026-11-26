import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  FIXED_STAGE,
  ProductionStageService,
  STAGE_ALREADY_IN_ORDER,
} from './production-stage.service';

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
    prisma.$transaction = jest.fn(async (ops) => ops);
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
        data: expect.objectContaining({
          status: 'DONE',
          prevStatus: 'NOT_STARTED',
        }),
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

    it('concluir tudo finaliza as etapas das agendas da empresa, fora a entrega, guardando o anterior', async () => {
      prisma.deliverySchedule.findMany.mockResolvedValue([
        { id: 'sch-1', status: 'IN_PRODUCTION' },
      ]);

      const result = await service.finishAll(['sch-1', 'sch-x'], 'c-1');

      expect(prisma.deliverySchedule.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['sch-1', 'sch-x'] }, ...scheduleOfCompany },
        select: { id: true, status: true },
      });
      // Um updateMany por estado aberto, cada um gravando o próprio anterior
      expect(prisma.productionItemStage.updateMany).toHaveBeenCalledWith({
        where: { scheduleId: { in: ['sch-1'] }, status: 'IN_PROGRESS' },
        data: expect.objectContaining({
          status: 'DONE',
          prevStatus: 'IN_PROGRESS',
        }),
      });
      expect(prisma.productionItemStage.updateMany).toHaveBeenCalledWith({
        where: { scheduleId: { in: ['sch-1'] }, status: 'NOT_STARTED' },
        // Quem concluiu fica gravado (§4.16)
        data: expect.objectContaining({
          status: 'DONE',
          prevStatus: 'NOT_STARTED',
          doneAt: expect.any(Date),
        }),
      });
      expect(prisma.productionStage.updateMany).toHaveBeenCalledWith({
        where: {
          scheduleId: { in: ['sch-1'] },
          status: 'PENDING',
          OR: [
            { stageId: null },
            { stage: { name: { notIn: ['Entrega', 'Cliente Retira'] } } },
          ],
        },
        data: { status: 'DONE', prevStatus: 'PENDING' },
      });
      const touched = [
        ...prisma.productionItemStage.updateMany.mock.calls,
        ...prisma.productionStage.updateMany.mock.calls,
      ].map(([arg]) => arg.where.status);
      expect(touched).not.toContain('DONE');
      expect(touched).not.toContain('CANCELED');
      expect(result).toEqual({
        finished: 1,
        skipped: 0,
        closed: 0,
        notFound: 1,
      });
    });

    it('concluir tudo ignora a agenda cancelada ou já entregue', async () => {
      prisma.deliverySchedule.findMany.mockResolvedValue([
        { id: 'sch-c', status: 'CANCELED' },
        { id: 'sch-f', status: 'FINISHED' },
      ]);

      const result = await service.finishAll(['sch-c', 'sch-f'], 'c-1');

      expect(prisma.productionItemStage.updateMany).not.toHaveBeenCalled();
      expect(prisma.productionStage.updateMany).not.toHaveBeenCalled();
      expect(prisma.deliverySchedule.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        finished: 0,
        skipped: 0,
        closed: 2,
        notFound: 0,
      });
    });

    it('o recálculo não mexe na agenda cancelada', async () => {
      prisma.deliverySchedule.findUnique.mockResolvedValue({
        status: 'CANCELED',
      });
      await service.updateStatusIfAllStagesAreDone('sch-c');
      expect(prisma.productionStage.findMany).not.toHaveBeenCalled();
      expect(prisma.deliverySchedule.update).not.toHaveBeenCalled();
    });

    it('tirar a pendência pelo pedido devolve a cada item o próprio estado anterior', async () => {
      prisma.productionStage.findFirst
        .mockResolvedValueOnce({
          id: 'st-imp',
          scheduleId: 'sch-1',
          stageId: 'sec-imp',
          status: 'PENDING',
          prevStatus: 'IN_PROGRESS',
        })
        .mockResolvedValueOnce({ id: 'st-imp', status: 'IN_PROGRESS' });
      prisma.productionItemStage.findMany
        .mockResolvedValueOnce([
          { id: 'a', status: 'PENDING', prevStatus: 'IN_PROGRESS' },
          { id: 'b', status: 'PENDING', prevStatus: 'NOT_STARTED' },
          { id: 'c', status: 'DONE', prevStatus: 'IN_PROGRESS' },
        ])
        .mockResolvedValueOnce([
          { status: 'IN_PROGRESS' },
          { status: 'NOT_STARTED' },
          { status: 'DONE' },
        ]);

      await service.update(
        'st-imp',
        { status: 'IN_PROGRESS', notes: '' } as any,
        'c-1',
      );

      expect(prisma.productionItemStage.update.mock.calls).toEqual([
        [
          {
            where: { id: 'a' },
            data: { status: 'IN_PROGRESS', prevStatus: 'PENDING', notes: '' },
          },
        ],
        [
          {
            where: { id: 'b' },
            data: { status: 'NOT_STARTED', prevStatus: 'PENDING', notes: '' },
          },
        ],
      ]);
    });

    it('voltar a etapa finalizada do pedido reabre os itens dela', async () => {
      prisma.productionStage.findFirst
        .mockResolvedValueOnce({
          id: 'st-imp',
          scheduleId: 'sch-1',
          stageId: 'sec-imp',
          status: 'DONE',
        })
        .mockResolvedValueOnce({ id: 'st-imp', status: 'IN_PROGRESS' });
      prisma.productionItemStage.findMany
        .mockResolvedValueOnce([
          { id: 'a', status: 'DONE' },
          { id: 'b', status: 'CANCELED' },
        ])
        .mockResolvedValueOnce([
          { status: 'IN_PROGRESS' },
          { status: 'CANCELED' },
        ]);

      await service.update('st-imp', { status: 'IN_PROGRESS' } as any, 'c-1');

      expect(prisma.productionItemStage.update).toHaveBeenCalledTimes(1);
      expect(prisma.productionItemStage.update).toHaveBeenCalledWith({
        where: { id: 'a' },
        // Reaberto, quem tinha concluído sai (§4.16)
        data: {
          status: 'IN_PROGRESS',
          prevStatus: 'DONE',
          doneAt: null,
          doneById: null,
          doneByName: null,
        },
      });
      // O resumo bate com a volta: nada é desfeito depois
      expect(prisma.productionStage.update).toHaveBeenCalledTimes(1);
    });

    it('cancelar pelo pedido fica cancelado, com o item feito ainda finalizado', async () => {
      prisma.productionStage.findFirst
        .mockResolvedValueOnce({
          id: 'st-imp',
          scheduleId: 'sch-1',
          stageId: 'sec-imp',
          status: 'IN_PROGRESS',
        })
        .mockResolvedValueOnce({ id: 'st-imp', status: 'CANCELED' });
      prisma.productionItemStage.findMany
        .mockResolvedValueOnce([
          { id: 'a', status: 'DONE' },
          { id: 'b', status: 'IN_PROGRESS' },
        ])
        .mockResolvedValueOnce([{ status: 'DONE' }, { status: 'CANCELED' }]);

      await service.update('st-imp', { status: 'CANCELED' } as any, 'c-1');

      expect(prisma.productionItemStage.update).toHaveBeenCalledTimes(1);
      expect(prisma.productionItemStage.update).toHaveBeenCalledWith({
        where: { id: 'b' },
        data: { status: 'CANCELED', prevStatus: 'IN_PROGRESS' },
      });
      expect(prisma.productionStage.update).toHaveBeenCalledTimes(1);
      expect(prisma.productionStage.update).toHaveBeenCalledWith({
        where: { id: 'st-imp' },
        data: { status: 'CANCELED', prevStatus: 'IN_PROGRESS' },
      });
    });
  });

  describe('ícones fixos e livres no pedido (§4.16)', () => {
    beforeEach(() => {
      prisma.productionItemStage.count = jest.fn().mockResolvedValue(0);
      prisma.productionItemStage.deleteMany = jest.fn();
      prisma.productionItemStage.createMany = jest.fn();
      prisma.productionStage.create = jest.fn();
      prisma.quotationProduct = {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'qp-1', productionItemStages: [{ order: 1 }, { order: 2 }] },
          ]),
      };
      prisma.companySector.findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'acab', name: 'Acabamento' });
      prisma.$transaction = jest.fn((fn) => fn(prisma));
    });

    it('o ícone fixo (etapa de cobrança) não sai do pedido', async () => {
      prisma.productionStage.findFirst.mockResolvedValue({
        id: 'st-1',
        scheduleId: 'sch-1',
        stageId: 'imp',
      });
      prisma.productionItemStage.count.mockResolvedValue(1);
      await expect(service.remove('st-1', 'c-1')).rejects.toThrow(
        new BadRequestException(FIXED_STAGE),
      );
      expect(prisma.productionStage.delete).not.toHaveBeenCalled();
    });

    it('o ícone livre sai do pedido e dos itens', async () => {
      prisma.productionStage.findFirst.mockResolvedValue({
        id: 'st-2',
        scheduleId: 'sch-1',
        stageId: 'criacao',
      });
      await service.remove('st-2', 'c-1');
      expect(prisma.productionItemStage.deleteMany).toHaveBeenCalledWith({
        where: { scheduleId: 'sch-1', stageId: 'criacao' },
      });
      expect(prisma.productionStage.delete).toHaveBeenCalledWith({
        where: { id: 'st-2' },
      });
    });

    it('acrescentar entra antes da entrega e em cada item', async () => {
      prisma.deliverySchedule.findFirst.mockResolvedValue({
        id: 'sch-1',
        status: 'IN_PRODUCTION',
      });
      prisma.productionStage.findMany.mockResolvedValue([
        { id: 'a', stageId: 'imp', order: 1, stage: { name: 'Impressão' } },
        { id: 'b', stageId: 'ent', order: 2, stage: { name: 'Entrega' } },
      ]);
      await service.addToSchedule('sch-1', 'acab', 'c-1');
      expect(prisma.productionStage.update).toHaveBeenCalledWith({
        where: { id: 'b' },
        data: { order: 3 },
      });
      expect(prisma.productionStage.create).toHaveBeenCalledWith({
        data: {
          scheduleId: 'sch-1',
          stageId: 'acab',
          order: 2,
          prevStatus: null,
        },
      });
      expect(prisma.productionItemStage.createMany).toHaveBeenCalledWith({
        data: [
          {
            scheduleId: 'sch-1',
            quotationProductId: 'qp-1',
            stageId: 'acab',
            order: 3,
          },
        ],
      });
    });

    it('o setor que o pedido já tem não entra de novo', async () => {
      prisma.deliverySchedule.findFirst.mockResolvedValue({
        id: 'sch-1',
        status: 'IN_PRODUCTION',
      });
      prisma.productionStage.findMany.mockResolvedValue([
        { id: 'a', stageId: 'acab', order: 1, stage: { name: 'Acabamento' } },
      ]);
      await expect(
        service.addToSchedule('sch-1', 'acab', 'c-1'),
      ).rejects.toThrow(new ConflictException(STAGE_ALREADY_IN_ORDER));
    });
  });

  describe('tela do setor e quem concluiu (§4.16)', () => {
    it('concluir a etapa do item grava quem e quando; voltar limpa', async () => {
      prisma.productionItemStage.findFirst.mockResolvedValue({
        id: 'is-1',
        scheduleId: 'sch-1',
        stageId: 'imp',
        status: 'NOT_STARTED',
      });
      await service.updateItem('is-1', { status: 'DONE' } as any, 'c-1', {
        userId: 'u-1',
        name: 'Ana',
      });
      expect(prisma.productionItemStage.update).toHaveBeenCalledWith({
        where: { id: 'is-1' },
        data: expect.objectContaining({
          status: 'DONE',
          doneById: 'u-1',
          doneByName: 'Ana',
          doneAt: expect.any(Date),
        }),
      });
      prisma.productionItemStage.findFirst.mockResolvedValue({
        id: 'is-1',
        scheduleId: 'sch-1',
        stageId: 'imp',
        status: 'DONE',
      });
      await service.updateItem('is-1', { status: 'PENDING' } as any, 'c-1');
      expect(prisma.productionItemStage.update).toHaveBeenLastCalledWith({
        where: { id: 'is-1' },
        data: expect.objectContaining({
          status: 'PENDING',
          doneAt: null,
          doneById: null,
          doneByName: null,
        }),
      });
    });

    it('a lista do setor diz o que falta antes no mesmo item', async () => {
      prisma.productionItemStage.groupBy = jest
        .fn()
        .mockResolvedValue([{ stageId: 'inst', _count: { _all: 2 } }]);
      prisma.productionItemStage.findMany
        .mockResolvedValueOnce([
          {
            id: 'is-2',
            status: 'NOT_STARTED',
            notes: null,
            fixed: true,
            doneAt: null,
            doneByName: null,
            order: 2,
            stageId: 'inst',
            scheduleId: 'sch-1',
            quotationProductId: 'qp-1',
            stage: {
              id: 'inst',
              name: 'Instalação',
              icon: 'track',
              color: null,
            },
            schedule: {
              id: 'sch-1',
              scheduledDate: new Date(),
              addScheduleTime: false,
            },
            quotationProduct: {
              id: 'qp-1',
              description: 'Carro adesivado',
              quantity: 1,
              items: [{ quantity: 1, width: 2000, height: 1000 }],
              quotation: {
                id: 'q-1',
                quotationNumber: 4,
                description: 'Frota',
                series: { code: 'V1' },
                client: { name: 'Padaria' },
              },
            },
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'is-1',
            quotationProductId: 'qp-1',
            scheduleId: 'sch-1',
            order: 1,
            status: 'NOT_STARTED',
            stage: { id: 'imp', name: 'Impressão' },
          },
          {
            id: 'is-2',
            quotationProductId: 'qp-1',
            scheduleId: 'sch-1',
            order: 2,
            status: 'NOT_STARTED',
            stage: { id: 'inst', name: 'Instalação' },
          },
        ]);
      const result = await service.workList('c-1', { stageId: 'inst' });
      expect(result.counts).toEqual({ inst: 2 });
      expect(result.items[0]).toMatchObject({
        reference: '4-V1',
        client: 'Padaria',
        item: 'Carro adesivado',
        waitingFor: ['Impressão'],
        fixed: true,
      });
      // O fluxo inteiro do item, com a etapa desta linha marcada
      expect(
        result.items[0].flow.map((step) => [step.sector.name, step.current]),
      ).toEqual([
        ['Impressão', false],
        ['Instalação', true],
      ]);
      expect(result.items[0].measure).toContain('2 × 1 m');
    });
  });
});
