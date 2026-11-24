import { ForbiddenException } from '@nestjs/common';
import { planCarry } from './order-redo';
import { OrderRedoService } from '../quotation/order-redo.service';

/** Refazer a O.S. (GP-51; Maicol, 23/11/2026). */
describe('refazer a O.S.', () => {
  const item = (id: string, productId: string, quantity: number) => ({
    id,
    productId,
    materialId: null,
    quantity,
    name: `Item ${productId}`,
  });

  it('a etapa feita na antiga conclui a mesma etapa na nova, pelo item', () => {
    const { carry, losses } = planCarry(
      [item('o1', 'lona', 100), item('o2', 'placa', 3)],
      [item('n1', 'lona', 50)],
      [
        {
          id: 't1',
          quotationProductId: 'o1',
          stageKey: 'impressao',
          status: 'DONE',
        },
        {
          id: 't2',
          quotationProductId: 'o1',
          stageKey: 'acabamento',
          status: 'NOT_STARTED',
        },
        { id: 't3', quotationProductId: 'o2', stageKey: 'cnc', status: 'DONE' },
      ],
      [
        {
          id: 'u1',
          quotationProductId: 'n1',
          stageKey: 'impressao',
          status: 'NOT_STARTED',
        },
        {
          id: 'u2',
          quotationProductId: 'n1',
          stageKey: 'acabamento',
          status: 'NOT_STARTED',
        },
      ],
    );
    expect(carry).toEqual(['u1']);
    expect(losses).toEqual([
      { item: 'Item lona', produced: 100, now: 50, excess: 50 },
      { item: 'Item placa', produced: 3, now: 0, excess: 3 },
    ]);
  });

  it('quantidade maior não tem excedente', () => {
    const { losses, carry } = planCarry(
      [item('o1', 'lona', 100)],
      [item('n1', 'lona', 150)],
      [
        {
          id: 't1',
          quotationProductId: 'o1',
          stageKey: 'impressao',
          status: 'DONE',
        },
      ],
      [
        {
          id: 'u1',
          quotationProductId: 'n1',
          stageKey: 'impressao',
          status: 'NOT_STARTED',
        },
      ],
    );
    expect(losses).toEqual([]);
    expect(carry).toEqual(['u1']);
  });

  const setup = (produced: number) => {
    const prisma: any = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'o1',
          status: 'IN_PRODUCTION',
          quotationId: 'q1',
        }),
      },
      orderRedo: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }) => ({ id: 'r1', ...data })),
        findFirst: jest.fn(),
        update: jest.fn(async ({ data }) => data),
      },
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
    };
    const crud: any = { duplicate: jest.fn().mockResolvedValue({ id: 'q2' }) };
    const orders: any = { cancelOrder: jest.fn() };
    return {
      service: new OrderRedoService(prisma, crud, orders),
      prisma,
      crud,
      orders,
    };
  };
  const actor = { companyId: 'c1', userId: 'u1', name: 'Ana' };

  it('com produção feita, o pedido espera a aprovação de outra pessoa', async () => {
    const { service, prisma, crud } = setup(2);
    const redo = await service.request(actor, 'o1', {
      reason: 'cliente mudou a quantidade',
      excess: 'CLIENT',
    });
    expect(redo).toMatchObject({ needsApproval: true });
    expect(crud.duplicate).not.toHaveBeenCalled();

    prisma.orderRedo.findFirst.mockResolvedValue({
      id: 'r1',
      status: 'PENDING_APPROVAL',
      requestedById: 'u1',
    });
    await expect(service.approve(actor, 'r1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('sem nada feito, refaz já: a nova em digitação e a antiga cancelada', async () => {
    const { service, prisma, crud, orders } = setup(0);
    prisma.orderRedo.findFirst.mockImplementation(async () => ({
      id: 'r1',
      orderId: 'o1',
      oldQuotationId: 'q1',
      needsApproval: false,
    }));
    const redo = await service.request(actor, 'o1', {
      reason: 'erro do vendedor',
      excess: 'COMPANY',
    });
    expect(crud.duplicate).toHaveBeenCalledWith(
      'q1',
      { description: 'Fachada (refaz a O.S. 12-V1)' },
      'u1',
    );
    expect(orders.cancelOrder).toHaveBeenCalledWith('o1', {}, 'u1');
    expect(redo).toMatchObject({ status: 'EXECUTED', newQuotationId: 'q2' });
  });
});
