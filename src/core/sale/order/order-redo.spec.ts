import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { planCarry, RedoItem } from './order-redo';
import { OrderRedoService } from '../quotation/order-redo.service';

/** Refazer a O.S. (GP-51; Maicol, 23/11/2026; revisão de 24/11/2026). */
describe('refazer a O.S.', () => {
  const item = (
    id: string,
    productId: string,
    quantity: number,
    extra: Partial<RedoItem> = {},
  ): RedoItem => ({
    id,
    productId,
    materialId: null,
    variationId: null,
    width: 2000,
    height: 1000,
    quantity,
    name: `Item ${productId}`,
    ...extra,
  });
  const done = (id: string, itemId: string, stageKey: string) => ({
    id,
    quotationProductId: itemId,
    stageKey,
    status: 'DONE',
  });
  const open = (id: string, itemId: string, stageKey: string) => ({
    id,
    quotationProductId: itemId,
    stageKey,
    status: 'NOT_STARTED',
  });

  describe('o que passa da antiga para a nova (planCarry)', () => {
    it('a etapa feita na antiga conclui a mesma etapa na nova, pelo item', () => {
      const { carry, blocked, losses } = planCarry(
        [item('o1', 'lona', 100), item('o2', 'placa', 3)],
        [item('n1', 'lona', 50)],
        [
          done('t1', 'o1', 'impressao'),
          open('t2', 'o1', 'acabamento'),
          done('t3', 'o2', 'cnc'),
        ],
        [open('u1', 'n1', 'impressao'), open('u2', 'n1', 'acabamento')],
      );
      expect(carry).toEqual(['u1']);
      expect(blocked).toEqual([]);
      expect(losses).toEqual([
        { item: 'Item lona', produced: 100, now: 50, excess: 50 },
        { item: 'Item placa', produced: 3, now: 0, excess: 3 },
      ]);
    });

    it('quantidade maior não passa a etapa, com o motivo, e não tem excedente', () => {
      const { losses, carry, blocked } = planCarry(
        [item('o1', 'lona', 100)],
        [item('n1', 'lona', 150)],
        [done('t1', 'o1', 'impressao')],
        [open('u1', 'n1', 'impressao')],
      );
      expect(carry).toEqual([]);
      expect(blocked).toEqual([
        { taskId: 'u1', reason: 'a quantidade passou de 100 para 150' },
      ]);
      expect(losses).toEqual([]);
    });

    it('outra variação ou outra medida não passa, e o feito vira excedente', () => {
      const variation = planCarry(
        [item('o1', 'lona', 10, { variationId: 'fosca' })],
        [item('n1', 'lona', 10, { variationId: 'brilho' })],
        [done('t1', 'o1', 'impressao')],
        [open('u1', 'n1', 'impressao')],
      );
      expect(variation.carry).toEqual([]);
      expect(variation.blocked).toEqual([
        { taskId: 'u1', reason: 'a variação do item mudou' },
      ]);
      expect(variation.losses).toEqual([
        { item: 'Item lona', produced: 10, now: 0, excess: 10 },
      ]);

      const measure = planCarry(
        [item('o1', 'lona', 10)],
        [item('n1', 'lona', 10, { width: 3000 })],
        [done('t1', 'o1', 'impressao')],
        [open('u1', 'n1', 'impressao')],
      );
      expect(measure.carry).toEqual([]);
      expect(measure.blocked).toEqual([
        { taskId: 'u1', reason: 'as medidas do item mudaram' },
      ]);
    });

    it('com dois itens do mesmo produto, casa primeiro o igual', () => {
      const { carry, blocked } = planCarry(
        [item('o1', 'lona', 5, { width: 1000 }), item('o2', 'lona', 2)],
        [item('n1', 'lona', 2)],
        [done('t1', 'o1', 'impressao'), done('t2', 'o2', 'impressao')],
        [open('u1', 'n1', 'impressao')],
      );
      expect(carry).toEqual(['u1']);
      expect(blocked).toEqual([]);
    });
  });

  const setup = (produced: number) => {
    const prisma: any = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'o1',
          status: 'IN_PRODUCTION',
          quotationId: 'q1',
        }),
        findUnique: jest.fn().mockResolvedValue({ status: 'IN_PRODUCTION' }),
      },
      orderRedo: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }) => ({ id: 'r1', ...data })),
        findFirst: jest.fn(),
        update: jest.fn(async ({ data }) => data),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      reasons: { findFirst: jest.fn().mockResolvedValue({ id: 'mot-1' }) },
      productionTask: { count: jest.fn().mockResolvedValue(produced) },
      productionStage: { count: jest.fn().mockResolvedValue(0) },
      stockMovement: { count: jest.fn().mockResolvedValue(0) },
      quotation: {
        findUnique: jest.fn().mockResolvedValue({
          description: 'Fachada',
          quotationNumber: 12,
          series: { code: 'V1' },
        }),
      },
      $executeRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn(async (run) => run(prisma));
    const crud: any = { duplicate: jest.fn().mockResolvedValue({ id: 'q2' }) };
    const orders: any = {
      cancelOrder: jest.fn(),
      verifySellerPermission: jest.fn(),
      countCancelReasons: jest.fn().mockResolvedValue(0),
    };
    const plan: any = {
      hasFeature: jest.fn().mockResolvedValue(false),
      enforceFeature: jest.fn(),
    };
    const mirror: any = { sync: jest.fn() };
    return {
      service: new OrderRedoService(prisma, crud, orders, plan, mirror),
      prisma,
      crud,
      orders,
      plan,
      mirror,
    };
  };
  const actor = { companyId: 'c1', userId: 'u1', name: 'Ana' };
  const approver = { companyId: 'c1', userId: 'u2', name: 'Bia' };
  const pendingRedo = {
    id: 'r1',
    orderId: 'o1',
    oldQuotationId: 'q1',
    status: 'PENDING_APPROVAL',
    needsApproval: true,
    requestedById: 'u1',
    cancelReasonId: null,
  };

  it('com produção feita, o pedido espera a aprovação de outra pessoa', async () => {
    const { service, prisma, crud } = setup(2);
    const redo = await service.request(actor, 'o1', {
      reason: 'cliente mudou a quantidade',
      excess: 'CLIENT',
    });
    expect(redo).toMatchObject({
      needsApproval: true,
      status: 'PENDING_APPROVAL',
    });
    expect(crud.duplicate).not.toHaveBeenCalled();
    // A trava por O.S. antes de contar os pedidos abertos
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.orderRedo.count).toHaveBeenCalledWith({
      where: {
        orderId: 'o1',
        status: { in: ['PENDING_APPROVAL', 'EXECUTING'] },
      },
    });

    prisma.orderRedo.findFirst.mockResolvedValue(pendingRedo);
    await expect(service.approve(actor, 'r1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('sem nada feito, refaz já: a nova em digitação e a antiga cancelada', async () => {
    const { service, prisma, crud, orders } = setup(0);
    const redo = await service.request(actor, 'o1', {
      reason: 'erro do vendedor',
      excess: 'COMPANY',
    });
    expect(prisma.orderRedo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'EXECUTING' }),
    });
    expect(orders.verifySellerPermission).toHaveBeenCalledWith('u1');
    expect(crud.duplicate).toHaveBeenCalledWith(
      'q1',
      { description: 'Fachada (refaz a O.S. 12-V1)' },
      'u1',
    );
    expect(orders.cancelOrder).toHaveBeenCalledWith('o1', {}, 'u1');
    expect(redo).toMatchObject({ status: 'EXECUTED', newQuotationId: 'q2' });
  });

  it('já com um pedido aberto, não nasce outro', async () => {
    const { service, prisma } = setup(2);
    prisma.orderRedo.count.mockResolvedValue(1);
    await expect(
      service.request(actor, 'o1', { reason: 'de novo', excess: 'COMPANY' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.orderRedo.create).not.toHaveBeenCalled();
  });

  it('aprovar duas vezes ao mesmo tempo gera uma execução só', async () => {
    const { service, prisma, crud, orders } = setup(2);
    prisma.orderRedo.findFirst.mockResolvedValue(pendingRedo);
    prisma.orderRedo.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const results = await Promise.allSettled([
      service.approve(approver, 'r1'),
      service.approve(approver, 'r1'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const failed = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ConflictException);
    expect(crud.duplicate).toHaveBeenCalledTimes(1);
    expect(orders.cancelOrder).toHaveBeenCalledTimes(1);
    expect(prisma.orderRedo.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', companyId: 'c1', status: 'PENDING_APPROVAL' },
      data: { status: 'EXECUTING', approvedById: 'u2', approvedByName: 'Bia' },
    });
  });

  it('o pedido já decidido não se aprova', async () => {
    const { service, prisma, crud } = setup(2);
    prisma.orderRedo.findFirst.mockResolvedValue({
      ...pendingRedo,
      status: 'FAILED',
    });
    await expect(service.approve(approver, 'r1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(crud.duplicate).not.toHaveBeenCalled();
  });

  it.each(['FINISHED', 'COMPLETED', 'CANCELED'])(
    'O.S. %s é recusada no pedido e na execução',
    async (status) => {
      const { service, prisma, crud, orders } = setup(2);
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        status,
        quotationId: 'q1',
      });
      await expect(
        service.request(actor, 'o1', { reason: 'x', excess: 'COMPANY' }),
      ).rejects.toThrow(
        new BadRequestException(
          'A O.S. cancelada, concluída ou finalizada não se refaz',
        ),
      );

      // Pedido feito antes da entrega e aprovado depois dela
      prisma.order.findUnique.mockResolvedValue({ status });
      prisma.orderRedo.findFirst.mockResolvedValue(pendingRedo);
      await expect(service.approve(approver, 'r1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(crud.duplicate).not.toHaveBeenCalled();
      expect(orders.cancelOrder).not.toHaveBeenCalled();
      expect(prisma.orderRedo.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: {
          status: 'FAILED',
          failReason: 'A O.S. cancelada, concluída ou finalizada não se refaz',
          newQuotationId: null,
        },
      });
    },
  );

  it('vendedor sem canCancelSale não gera cópia', async () => {
    const denied = new ForbiddenException(
      'Você não tem permissão para cancelar uma ordem de serviço.',
    );

    // Aprovando: o pedido segue esperando quem possa cancelar
    const approving = setup(2);
    approving.orders.verifySellerPermission.mockRejectedValue(denied);
    approving.prisma.orderRedo.findFirst.mockResolvedValue(pendingRedo);
    await expect(
      approving.service.approve(approver, 'r1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(approving.prisma.orderRedo.updateMany).not.toHaveBeenCalled();
    expect(approving.crud.duplicate).not.toHaveBeenCalled();

    // Sem aprovação (executa já): nem o pedido nasce
    const now = setup(0);
    now.orders.verifySellerPermission.mockRejectedValue(denied);
    await expect(
      now.service.request(actor, 'o1', { reason: 'x', excess: 'COMPANY' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(now.prisma.orderRedo.create).not.toHaveBeenCalled();
    expect(now.crud.duplicate).not.toHaveBeenCalled();
  });

  it('a falha depois da cópia deixa o pedido FAILED, com o motivo e a cópia', async () => {
    const { service, prisma, orders } = setup(2);
    prisma.orderRedo.findFirst.mockResolvedValue(pendingRedo);
    orders.cancelOrder.mockRejectedValue(
      new BadRequestException('Erro ao cancelar a ordem de serviço.'),
    );
    await expect(service.approve(approver, 'r1')).rejects.toThrow(
      new ConflictException(
        'Não deu para refazer a O.S.: Erro ao cancelar a ordem de serviço. A O.S. nova (a cópia) ficou em digitação',
      ),
    );
    expect(prisma.orderRedo.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        status: 'FAILED',
        failReason:
          'Erro ao cancelar a ordem de serviço. A O.S. nova (a cópia) ficou em digitação',
        newQuotationId: 'q2',
      },
    });
  });

  it('com motivos de cancelamento cadastrados, o motivo é obrigatório e vai para o cancelamento', async () => {
    const { service, prisma, plan, orders } = setup(0);
    plan.hasFeature.mockResolvedValue(true);
    orders.countCancelReasons.mockResolvedValue(2);

    await expect(
      service.request(actor, 'o1', { reason: 'x', excess: 'COMPANY' }),
    ).rejects.toThrow(
      new BadRequestException('Informe o motivo do cancelamento'),
    );
    expect(prisma.orderRedo.create).not.toHaveBeenCalled();

    await service.request(actor, 'o1', {
      reason: 'x',
      excess: 'COMPANY',
      reasonId: 'mot-1',
    });
    expect(prisma.reasons.findFirst).toHaveBeenCalledWith({
      where: { id: 'mot-1', companyId: 'c1' },
      select: { id: true },
    });
    expect(prisma.orderRedo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cancelReasonId: 'mot-1' }),
    });
    expect(orders.cancelOrder).toHaveBeenCalledWith(
      'o1',
      { reasonId: 'mot-1' },
      'u1',
    );
  });

  it('recusar é condicional: o pedido decidido por outro responde 409', async () => {
    const { service, prisma } = setup(2);
    prisma.orderRedo.findFirst.mockResolvedValue(pendingRedo);
    prisma.orderRedo.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reject(approver, 'r1', 'não')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  describe('as etapas na O.S. nova (carryOver)', () => {
    const row = (id: string, quantity: number) => ({
      id,
      productId: 'lona',
      materialId: null,
      variationId: null,
      materialVariationId: null,
      quantity,
      description: 'Lona',
      snapshot: { data: { measure: { width: 2000, height: 1000 } } },
      items: [],
    });

    const carrySetup = (newQuantity: number) => {
      const ctx = setup(2);
      const { prisma } = ctx;
      prisma.orderRedo.findFirst.mockResolvedValue({
        id: 'r1',
        oldQuotationId: 'q1',
        status: 'EXECUTED',
        approvedByName: 'Bia',
        requestedByName: 'Ana',
      });
      prisma.quotationProduct = {
        findMany: jest.fn(async ({ where }) =>
          where.quotationId === 'q1'
            ? [row('o1', 10)]
            : [row('n1', newQuantity)],
        ),
      };
      prisma.productionTask.findMany = jest.fn(async ({ where }) =>
        where.project.quotationId === 'q1'
          ? [done('t1', 'o1', 'impressao')]
          : [open('u1', 'n1', 'impressao')],
      );
      prisma.productionTask.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });
      prisma.productionTaskHistory = { create: jest.fn() };
      prisma.productionProject = {
        findUnique: jest.fn().mockResolvedValue({ id: 'p2' }),
      };
      return ctx;
    };

    it('passa a etapa feita e sincroniza a agenda do ELITE', async () => {
      const { service, prisma, mirror } = carrySetup(10);
      await service.carryOver('q2');
      expect(prisma.orderRedo.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', carriedAt: null },
        data: { carriedAt: expect.any(Date) },
      });
      expect(prisma.productionTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', status: 'NOT_STARTED' },
        data: expect.objectContaining({ status: 'DONE' }),
      });
      expect(mirror.sync).toHaveBeenCalledWith('p2');
    });

    it('com quantidade maior, a etapa não passa e o motivo vai para o histórico', async () => {
      const { service, prisma, mirror } = carrySetup(15);
      await service.carryOver('q2');
      expect(prisma.productionTask.updateMany).not.toHaveBeenCalled();
      expect(prisma.productionTaskHistory.create).toHaveBeenCalledWith({
        data: {
          taskId: 'u1',
          byName: 'Bia',
          text: 'Feita na O.S. refeita, mas não passou para esta: a quantidade passou de 10 para 15',
        },
      });
      expect(mirror.sync).not.toHaveBeenCalled();
    });

    it('a segunda vez ao mesmo tempo não passa nada', async () => {
      const { service, prisma } = carrySetup(10);
      prisma.orderRedo.updateMany.mockResolvedValue({ count: 0 });
      await service.carryOver('q2');
      expect(prisma.productionTask.updateMany).not.toHaveBeenCalled();
    });
  });
});
