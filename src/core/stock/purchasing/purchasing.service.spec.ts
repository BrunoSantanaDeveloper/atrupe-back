import { PurchasingService } from './purchasing.service';

const actor = { id: 'e1', name: 'Ana' };

const request = (id: string, number: number) => ({
  id,
  number,
  status: 'QUOTING',
  materialId: `m-${id}`,
  variationId: null,
  description: `Material ${id}`,
  unit: 'm²',
});

const quote = (
  id: string,
  requestId: string,
  supplier: string,
  unitPrice: number,
  quantity = 10,
) => ({
  id,
  requestId,
  supplierId: `s-${supplier}`,
  supplierName: supplier,
  unitPrice,
  quantity,
  request: request(requestId, Number(requestId.slice(1))),
});

const setup = () => {
  const created = {
    orders: [] as any[],
    items: [] as any[],
    lots: [] as any[],
  };
  const prisma: any = {
    purchaseQuote: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    purchaseOrder: {
      aggregate: jest.fn().mockImplementation(async () => ({
        _max: { number: created.orders.length },
      })),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const row = { id: `o${created.orders.length + 1}`, ...data };
        created.orders.push(row);
        return row;
      }),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    purchaseOrderItem: {
      create: jest.fn().mockImplementation(async ({ data }) => {
        const row = { id: `i${created.items.length + 1}`, ...data };
        created.items.push(row);
        return row;
      }),
    },
    purchaseRequest: { update: jest.fn(), updateMany: jest.fn() },
    purchaseEvent: { create: jest.fn() },
    stockLot: {
      aggregate: jest.fn().mockResolvedValue({ _max: { number: 7 } }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        created.lots.push(data);
        return data;
      }),
    },
    stockItem: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'st1' }),
    },
    stockMovement: { create: jest.fn() },
    material: { findUnique: jest.fn().mockResolvedValue(null) },
    inboundInvoice: { findUnique: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (fn) => fn(prisma));
  const stock = { confirm: jest.fn() };
  const pricing = { chargesOf: jest.fn().mockResolvedValue({}) };
  const service = new PurchasingService(
    prisma as never,
    stock as never,
    pricing as never,
  );
  jest
    .spyOn(service, 'order')
    .mockImplementation(async (_c, id) => ({ id }) as never);
  return { service, prisma, created, stock };
};

describe('PurchasingService (compras do FULL)', () => {
  it('fechar o pedido: um pedido por fornecedor, com o total', async () => {
    const { service, prisma, created } = setup();
    prisma.purchaseQuote.findMany.mockResolvedValue([
      quote('q1', 'r1', 'Lonas SA', 1500),
      quote('q2', 'r2', 'Lonas SA', 200, 50),
      quote('q3', 'r3', 'Tintas', 9000, 1),
    ]);
    await service.closeOrder(
      'c1',
      { quoteIds: ['q1', 'q2', 'q3'], expectedAt: '2026-11-30' },
      actor,
    );
    expect(
      created.orders.map((order) => [order.supplierName, order.total]),
    ).toEqual([
      ['Lonas SA', 25000],
      ['Tintas', 9000],
    ]);
    expect(created.items).toHaveLength(3);
    expect(prisma.purchaseRequest.update).toHaveBeenCalledTimes(3);
  });

  it('uma cotação por solicitação', async () => {
    const { service, prisma } = setup();
    prisma.purchaseQuote.findMany.mockResolvedValue([
      quote('q1', 'r1', 'Lonas SA', 1500),
      quote('q2', 'r1', 'Outra', 1400),
    ]);
    await expect(
      service.closeOrder('c1', { quoteIds: ['q1', 'q2'] }, actor),
    ).rejects.toThrow('Escolha uma cotação por solicitação');
  });

  it('lançar sem nota: entra o que chegou, e os lotes dividem o custo', async () => {
    const { service, prisma, created, stock } = setup();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'o1',
      number: 3,
      status: 'CHECKING',
      checkedAt: new Date(),
      supplierName: 'Lonas SA',
      invoiceId: null,
      items: [
        {
          id: 'i1',
          requestId: 'r1',
          materialId: 'm1',
          variationId: null,
          description: 'Adesivo',
          quantity: 122,
          receivedQuantity: 122,
          unitPrice: 383,
        },
      ],
      events: [],
    });
    await service.receive(
      'c1',
      'o1',
      {
        lots: [
          {
            itemId: 'i1',
            measure: 'ROLL',
            count: 2,
            width: 1.22,
            length: 50,
          },
        ],
      },
      actor,
    );
    expect(stock.confirm).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(
      created.lots.map((lot) => [lot.number, lot.quantity, lot.cost]),
    ).toEqual([
      [8, 61, 23363],
      [9, 61, 23363],
    ]);
    expect(prisma.purchaseRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1'] } },
      data: { status: 'RECEIVED' },
    });
  });

  it('com a nota conferida, a entrada é a da nota (uma vez só)', async () => {
    const { service, prisma, stock } = setup();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 'o1',
      number: 3,
      status: 'CHECKING',
      checkedAt: new Date(),
      supplierName: 'Lonas SA',
      invoiceId: 'nf1',
      items: [
        {
          id: 'i1',
          requestId: null,
          materialId: 'm1',
          variationId: null,
          description: 'Adesivo',
          quantity: 10,
          receivedQuantity: 10,
          unitPrice: 100,
        },
      ],
      events: [],
    });
    prisma.inboundInvoice.findUnique.mockResolvedValue({ status: 'MATCHED' });
    await service.receive('c1', 'o1', {}, actor);
    expect(stock.confirm).toHaveBeenCalledWith('c1', 'nf1', actor);
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });
});
