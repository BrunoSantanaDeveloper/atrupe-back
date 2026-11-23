import { ConflictException } from '@nestjs/common';
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
    purchaseRequest: {
      update: jest.fn(),
      // Todas as solicitações ainda em aberto
      updateMany: jest.fn(async ({ where }) => ({
        count: where.id?.in?.length ?? 1,
      })),
    },
    purchaseEvent: { create: jest.fn() },
    bankAccount: {
      findFirst: jest.fn().mockResolvedValue({ id: 'bank1' }),
    },
    nature: { findFirst: jest.fn().mockResolvedValue({ id: 'nat-op' }) },
    subCategory: {
      findFirst: jest.fn().mockResolvedValue({ id: 'sub-mp' }),
    },
    payable: {
      create: jest.fn().mockResolvedValue({ id: 'p1' }),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    payableInstallment: {
      create: jest.fn(),
      updateMany: jest.fn(async ({ where }) => ({
        count: where.id.in.length,
      })),
    },
    payableHistory: { create: jest.fn() },
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
  prisma.$executeRaw = jest.fn(async () => 0);
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

  it('fechar o pedido duas vezes: a segunda encontra a solicitação em pedido', async () => {
    const { service, prisma, created } = setup();
    prisma.purchaseQuote.findMany.mockResolvedValue([
      quote('q1', 'r1', 'Lonas SA', 1500),
      quote('q2', 'r2', 'Tintas', 200),
    ]);
    // Só uma das duas ainda estava em aberto
    prisma.purchaseRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(
      service.closeOrder('c1', { quoteIds: ['q1', 'q2'] }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.purchaseRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['r1', 'r2'] },
        companyId: 'c1',
        status: { in: ['REQUESTED', 'QUOTING'] },
      },
      data: { status: 'ORDERED' },
    });
    expect(created.orders).toEqual([]);
  });

  it('a numeração trava por empresa antes de ler o maior número', async () => {
    const { service, prisma } = setup();
    prisma.purchaseQuote.findMany.mockResolvedValue([
      quote('q1', 'r1', 'Lonas SA', 1500),
    ]);
    await service.closeOrder('c1', { quoteIds: ['q1'] }, actor);
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual([
      'numbering:purchase_orders:c1',
    ]);
  });

  describe('contas a pagar e cancelamento (ES-15)', () => {
    const order = (extra: Record<string, unknown> = {}) => ({
      id: 'o1',
      number: 3,
      status: 'PENDING_DELIVERY',
      checkedAt: null,
      supplierId: 's-lonas',
      supplierName: 'Lonas SA',
      invoiceId: null,
      payableId: null,
      total: 10000,
      items: [
        {
          id: 'i1',
          requestId: 'r1',
          materialId: 'm1',
          variationId: null,
          description: 'Adesivo',
          quantity: 10,
          receivedQuantity: null,
          unitPrice: 1000,
        },
      ],
      events: [],
      ...extra,
    });

    it('gera em Operacional › Matéria Prima, com o histórico e a marca condicional', async () => {
      const { service, prisma } = setup();
      prisma.purchaseOrder.findFirst.mockResolvedValue(order());
      await service.payables(
        'c1',
        'o1',
        { installments: 2, firstDue: '2026-12-10' },
        actor,
      );
      expect(prisma.bankAccount.findFirst).toHaveBeenCalledWith({
        where: { companyId: 'c1', isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      expect(prisma.payable.create.mock.calls[0][0].data).toMatchObject({
        natureId: 'nat-op',
        subCategoryId: 'sub-mp',
        supplierId: 's-lonas',
        totalAmount: 10000,
        installmentQty: 2,
      });
      expect(prisma.payableInstallment.create).toHaveBeenCalledTimes(2);
      expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'o1',
          companyId: 'c1',
          payableId: null,
          status: { not: 'CANCELED' },
        },
        data: { payableId: 'p1' },
      });
      expect(prisma.payableHistory.create.mock.calls[0][0].data).toMatchObject({
        payableId: 'p1',
        action: 'CREATE',
        createdBy: 'e1',
      });
    });

    it('sem a natureza na empresa, gera sem classificar', async () => {
      const { service, prisma } = setup();
      prisma.purchaseOrder.findFirst.mockResolvedValue(order());
      prisma.nature.findFirst.mockResolvedValue(null);
      await service.payables(
        'c1',
        'o1',
        { installments: 1, firstDue: '2026-12-10' },
        actor,
      );
      expect(prisma.payable.create.mock.calls[0][0].data).toMatchObject({
        natureId: null,
        subCategoryId: null,
      });
    });

    it('o segundo pedido de gerar ao mesmo tempo é recusado e desfaz tudo', async () => {
      const { service, prisma } = setup();
      prisma.purchaseOrder.findFirst.mockResolvedValue(order());
      prisma.purchaseOrder.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.payables(
          'c1',
          'o1',
          { installments: 1, firstDue: '2026-12-10' },
          actor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.payableHistory.create).not.toHaveBeenCalled();
    });

    it('não gera parcela de zero centavo', async () => {
      const { service, prisma } = setup();
      prisma.purchaseOrder.findFirst.mockResolvedValue(order({ total: 2 }));
      await expect(
        service.payables(
          'c1',
          'o1',
          { installments: 3, firstDue: '2026-12-10' },
          actor,
        ),
      ).rejects.toThrow('pelo menos um centavo');
      expect(prisma.payable.create).not.toHaveBeenCalled();
    });

    it('cancelar o pedido com parcela paga é recusado', async () => {
      const { service, prisma } = setup();
      prisma.purchaseOrder.findFirst.mockResolvedValue(
        order({ payableId: 'p1' }),
      );
      prisma.payable.findFirst.mockResolvedValue({
        id: 'p1',
        status: 'PENDING',
        installments: [
          {
            id: 'pi1',
            installmentNumber: 1,
            status: 'PAID',
            paidAmount: 5000,
            transactionId: 't1',
          },
          {
            id: 'pi2',
            installmentNumber: 2,
            status: 'PENDING',
            paidAmount: null,
            transactionId: null,
          },
        ],
      });
      await expect(
        service.cancelOrder('c1', 'o1', 'Fornecedor desistiu', actor),
      ).rejects.toThrow('parcela paga (1)');
      expect(prisma.payable.update).not.toHaveBeenCalled();
    });

    it('cancelar o pedido cancela as contas a pagar, na mesma transação', async () => {
      const { service, prisma } = setup();
      prisma.purchaseOrder.findFirst.mockResolvedValue(
        order({ payableId: 'p1', status: 'CHECKING' }),
      );
      prisma.payable.findFirst.mockResolvedValue({
        id: 'p1',
        status: 'PENDING',
        installments: [
          {
            id: 'pi1',
            installmentNumber: 1,
            status: 'PENDING',
            paidAmount: null,
            transactionId: null,
          },
          {
            id: 'pi2',
            installmentNumber: 2,
            status: 'PENDING',
            paidAmount: null,
            transactionId: null,
          },
        ],
      });
      await service.cancelOrder('c1', 'o1', 'Fornecedor desistiu', actor);
      expect(prisma.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'o1',
          companyId: 'c1',
          status: { in: ['PENDING_DELIVERY', 'CHECKING'] },
          payableId: 'p1',
        },
        data: { status: 'CANCELED', cancelReason: 'Fornecedor desistiu' },
      });
      expect(
        prisma.payableInstallment.updateMany.mock.calls[0][0],
      ).toMatchObject({
        where: { id: { in: ['pi1', 'pi2'] } },
        data: { status: 'CANCELED' },
      });
      expect(prisma.payable.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: {
          status: 'CANCELED',
          cancelReason: 'Pedido de compra 3 cancelado: Fornecedor desistiu',
        },
      });
      expect(prisma.payableHistory.create.mock.calls[0][0].data).toMatchObject({
        payableId: 'p1',
        action: 'CANCEL',
      });
    });

    it('cancelar o pedido que entrou no estoque no meio tempo é recusado', async () => {
      const { service, prisma } = setup();
      prisma.purchaseOrder.findFirst.mockResolvedValue(
        order({ status: 'CHECKING' }),
      );
      prisma.purchaseOrder.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.cancelOrder('c1', 'o1', 'Desisti', actor),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.purchaseRequest.updateMany).not.toHaveBeenCalled();
    });
  });
});
