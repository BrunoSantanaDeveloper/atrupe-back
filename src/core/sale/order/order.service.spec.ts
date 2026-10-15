import { Test, TestingModule } from '@nestjs/testing';
import { OrderService } from './order.service';
import { PrismaService } from 'nestjs-prisma';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

// Mock the includes and transformers to avoid deep import chains
jest.mock('./order.includes', () => ({
  ORDER_FIND_ONE_INCLUDE: {},
}));

jest.mock('./order.transformers', () => ({
  transformOrderToResponse: jest.fn((order: any, financial: any) => ({
    id: order.id,
    ...financial,
  })),
}));

const mockOrderId = 'order-uuid-789';
const mockQuotationId = 'quotation-uuid-456';
const mockCompanyId = 'company-uuid-123';
const mockSellerId = 'seller-uuid-101';

const createMockPrismaService = () => {
  const mock: any = {
    quotation: {
      findFirst: jest.fn(),
    },
    order: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    sellerProfile: {
      findFirst: jest.fn(),
    },
    reasons: {
      findFirst: jest.fn(),
    },
    receivableInstallment: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    payableInstallment: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    receivable: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    payable: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    deliverySchedule: {
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Gerente' }) },
    // O projeto de produção (ELITE): sem projeto, por padrão
    productionProject: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    productionTask: { findMany: jest.fn(), updateMany: jest.fn() },
    productionTaskHistory: { createMany: jest.fn() },
    productionTimeEntry: { update: jest.fn() },
  };
  // $transaction executes callback with the same mock (pass-through)
  mock.$transaction = jest.fn((cb: (prisma: any) => Promise<any>) => cb(mock));
  return mock;
};

describe('OrderService', () => {
  let service: OrderService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should load only phase-defining NF-e statuses for the invoice list', async () => {
      prisma.order.count.mockResolvedValue(1);
      prisma.order.findMany.mockResolvedValue([
        {
          id: mockOrderId,
          status: OrderStatus.FINISHED,
          createdAt: new Date('2026-01-13T12:00:00.000Z'),
          nfes: [],
          nfces: [
            {
              id: 'processing-nfce-1',
              numero: 2,
              serie: 1,
              status: 'PROCESSING',
              danfeUrl: null,
            },
          ],
          nfses: [
            {
              id: 'processing-nfse-1',
              numero: 3,
              serie: 'A1',
              status: 'PROCESSING',
              pdfUrl: null,
            },
          ],
          nfeOrders: [
            {
              nfe: {
                id: 'draft-nfe-1',
                numero: 1,
                serie: 1,
                status: 'DRAFT',
                danfeUrl: null,
              },
            },
          ],
          quotation: {
            id: mockQuotationId,
            description: null,
            status: 'APPROVED',
            dueDate: null,
            totalValue: 16000,
            approvedAt: null,
            quickSale: false,
            tag: null,
            series: { id: 'series-1', title: 'Vendas', code: 'V1' },
            quotationNumber: 34,
            client: {
              id: 'client-1',
              name: 'Corpori',
              email: 'contato@corpori.com',
            },
            seller: null,
            deliveryInfo: null,
            quotationPayment: null,
          },
        },
      ]);

      const result = await service.findAll({
        page: '1',
        limit: '20',
        nfeStatus: 'EM_DIGITACAO',
      } as any);

      const findManyArgs = prisma.order.findMany.mock.calls[0][0];
      expect(findManyArgs.include.nfes.where).toEqual({
        status: { in: ['AUTHORIZED', 'DRAFT'] },
      });
      expect(findManyArgs.include.nfes.take).toBeUndefined();
      expect(findManyArgs.include.nfeOrders.where).toEqual({
        nfe: { status: { in: ['AUTHORIZED', 'DRAFT'] } },
      });
      expect(findManyArgs.include.nfeOrders.take).toBeUndefined();
      expect(findManyArgs.include.nfces.where).toEqual({
        status: {
          in: ['AUTHORIZED', 'CONTINGENCY', 'PROCESSING', 'UNKNOWN', 'PENDING'],
        },
      });
      expect(findManyArgs.include.nfses.where).toEqual({
        status: {
          in: ['AUTHORIZED', 'PROCESSING', 'PENDING', 'DRAFT'],
        },
      });
      expect((result.data as any[])[0].orders[0].nfes).toEqual([
        {
          id: 'draft-nfe-1',
          numero: 1,
          serie: 1,
          status: 'DRAFT',
          danfeUrl: null,
        },
      ]);
      expect((result.data as any[])[0].orders[0].nfces).toEqual([
        {
          id: 'processing-nfce-1',
          numero: 2,
          serie: 1,
          status: 'PROCESSING',
          danfeUrl: null,
        },
      ]);
      expect((result.data as any[])[0].orders[0].nfses).toEqual([
        {
          id: 'processing-nfse-1',
          numero: 3,
          serie: 'A1',
          status: 'PROCESSING',
          pdfUrl: null,
        },
      ]);
    });
  });

  describe('count', () => {
    it('should return total order count', async () => {
      prisma.order.count.mockResolvedValue(42);

      const result = await service.count();
      expect(result).toBe(42);
    });
  });

  describe('findAllQuantity', () => {
    it('should return grouped status counts', async () => {
      prisma.order.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: 5 },
        { status: 'IN_PRODUCTION', _count: 10 },
        { status: 'FINISHED', _count: 3 },
      ]);

      const result = await service.findAllQuantity(mockCompanyId);

      expect(result.PENDING).toBe(5);
      expect(result.IN_PRODUCTION).toBe(10);
      expect(result.FINISHED).toBe(3);
      expect(result.CANCELED).toBe(0);
      expect(result.TOTAL).toBe(18);
    });

    it('should merge COMPLETED and DELIVERY into IN_PRODUCTION when no raw IN_PRODUCTION', async () => {
      // When only COMPLETED and DELIVERY statuses exist (no raw IN_PRODUCTION),
      // they accumulate via += into the IN_PRODUCTION counter
      prisma.order.groupBy.mockResolvedValue([
        { status: 'COMPLETED', _count: 2 },
        { status: 'DELIVERY', _count: 3 },
      ]);

      const result = await service.findAllQuantity(mockCompanyId);

      expect(result.IN_PRODUCTION).toBe(5); // 2 + 3
    });

    it('should filter by sellerId when provided', async () => {
      prisma.order.groupBy.mockResolvedValue([]);

      await service.findAllQuantity(mockCompanyId, mockSellerId);

      expect(prisma.order.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            quotation: expect.objectContaining({
              companyId: mockCompanyId,
              sellerId: mockSellerId,
            }),
          }),
        }),
      );
    });

    it('should return zero counts when no orders exist', async () => {
      prisma.order.groupBy.mockResolvedValue([]);

      const result = await service.findAllQuantity(mockCompanyId);

      expect(result.PENDING).toBe(0);
      expect(result.IN_PRODUCTION).toBe(0);
      expect(result.FINISHED).toBe(0);
      expect(result.CANCELED).toBe(0);
      expect(result.TOTAL).toBe(0);
    });
  });

  describe('cancelOrder', () => {
    const mockOrderWithQuotation = {
      quotation: { id: mockQuotationId },
    };

    beforeEach(() => {
      // Default: seller has cancel permission
      prisma.sellerProfile.findFirst.mockResolvedValue({
        id: 'profile-1',
        canCancelSale: true,
      });
      prisma.order.findUnique.mockResolvedValue(mockOrderWithQuotation);
    });

    it('motivo de outra empresa: 404, sem cancelar nada', async () => {
      prisma.order.findUnique.mockResolvedValue({
        quotation: { id: mockQuotationId, companyId: mockCompanyId },
      });
      prisma.reasons.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelOrder(
          mockOrderId,
          { reasonId: 'reason-b' },
          mockSellerId,
        ),
      ).rejects.toThrow(
        new NotFoundException('Motivo de cancelamento não encontrado.'),
      );
      expect(prisma.reasons.findFirst).toHaveBeenCalledWith({
        where: { id: 'reason-b', companyId: mockCompanyId },
      });
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException if seller cannot cancel', async () => {
      prisma.sellerProfile.findFirst.mockResolvedValue({
        id: 'profile-1',
        canCancelSale: false,
      });

      await expect(
        service.cancelOrder(mockOrderId, {}, mockSellerId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow cancel if no seller profile found (admin)', async () => {
      prisma.sellerProfile.findFirst.mockResolvedValue(null);
      prisma.order.findUnique.mockResolvedValue(mockOrderWithQuotation);
      prisma.receivableInstallment.count.mockResolvedValue(0);
      prisma.payableInstallment.count.mockResolvedValue(0);
      prisma.receivable.findMany.mockResolvedValue([]);
      prisma.payable.findMany.mockResolvedValue([]);
      prisma.deliverySchedule.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.update.mockResolvedValue({
        id: mockOrderId,
        status: OrderStatus.CANCELED,
      });

      const result = await service.cancelOrder(mockOrderId, {}, mockSellerId);

      expect(result.order.status).toBe(OrderStatus.CANCELED);
    });

    it('should throw when order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelOrder('invalid-id', {}, mockSellerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should cancel pending receivable and payable installments', async () => {
      prisma.receivableInstallment.count.mockResolvedValue(3);
      prisma.payableInstallment.count.mockResolvedValue(2);

      prisma.receivable.findMany.mockResolvedValue([
        {
          id: 'recv-1',
          installments: [
            { status: 'PENDING' },
            { status: 'PAID' },
            { status: 'OVERDUE' },
          ],
        },
      ]);

      prisma.payable.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          installments: [{ status: 'PENDING' }, { status: 'PAID' }],
        },
      ]);

      prisma.receivableInstallment.updateMany.mockResolvedValue({ count: 2 });
      prisma.payableInstallment.updateMany.mockResolvedValue({ count: 1 });
      prisma.receivable.update.mockResolvedValue({});
      prisma.payable.update.mockResolvedValue({});
      prisma.deliverySchedule.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.update.mockResolvedValue({
        id: mockOrderId,
        status: OrderStatus.CANCELED,
      });

      const result = await service.cancelOrder(mockOrderId, {}, mockSellerId);

      expect(result.canceledInstallments.receivables).toBe(2);
      expect(result.canceledInstallments.payables).toBe(1);
      expect(result.keptInstallments.receivables).toBe(1);
      expect(result.keptInstallments.payables).toBe(1);
      expect(result.summary.totalInstallments).toBe(5);
    });

    it('cancela junto o projeto de produção em aberto (ELITE)', async () => {
      prisma.receivableInstallment.count.mockResolvedValue(0);
      prisma.payableInstallment.count.mockResolvedValue(0);
      prisma.receivable.findMany.mockResolvedValue([]);
      prisma.payable.findMany.mockResolvedValue([]);
      prisma.deliverySchedule.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.update.mockResolvedValue({
        id: mockOrderId,
        status: OrderStatus.CANCELED,
      });
      prisma.productionProject.findUnique.mockResolvedValue({
        id: 'pj-1',
        status: 'PRODUCTION',
      });
      prisma.productionTask.findMany.mockResolvedValue([
        {
          id: 'tk-1',
          timeEntries: [{ id: 'te-1', start: new Date(Date.now() - 60000) }],
        },
      ]);

      await service.cancelOrder(mockOrderId, {}, mockSellerId);

      expect(prisma.productionTimeEntry.update).toHaveBeenCalledWith({
        where: { id: 'te-1' },
        data: { end: expect.any(Date), seconds: expect.any(Number) },
      });
      expect(prisma.productionTask.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['tk-1'] } },
        data: { status: 'CANCELED' },
      });
      expect(prisma.productionProject.update).toHaveBeenCalledWith({
        where: { id: 'pj-1' },
        data: expect.objectContaining({
          status: 'CANCELED',
          history: {
            create: expect.objectContaining({
              byName: 'Gerente',
              text: 'Cancelado com a ordem de serviço',
            }),
          },
        }),
      });
    });

    it('o projeto concluído fica como está', async () => {
      prisma.receivableInstallment.count.mockResolvedValue(0);
      prisma.payableInstallment.count.mockResolvedValue(0);
      prisma.receivable.findMany.mockResolvedValue([]);
      prisma.payable.findMany.mockResolvedValue([]);
      prisma.deliverySchedule.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.update.mockResolvedValue({
        id: mockOrderId,
        status: OrderStatus.CANCELED,
      });
      prisma.productionProject.findUnique.mockResolvedValue({
        id: 'pj-1',
        status: 'DONE',
      });

      await service.cancelOrder(mockOrderId, {}, mockSellerId);

      expect(prisma.productionProject.update).not.toHaveBeenCalled();
    });

    it('should handle no financial records gracefully', async () => {
      prisma.receivableInstallment.count.mockResolvedValue(0);
      prisma.payableInstallment.count.mockResolvedValue(0);
      prisma.receivable.findMany.mockResolvedValue([]);
      prisma.payable.findMany.mockResolvedValue([]);
      prisma.deliverySchedule.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.update.mockResolvedValue({
        id: mockOrderId,
        status: OrderStatus.CANCELED,
      });

      const result = await service.cancelOrder(mockOrderId, {}, mockSellerId);

      expect(result.canceledInstallments.total).toBe(0);
      expect(result.keptInstallments.total).toBe(0);
    });

    it('should handle delivery schedule not found gracefully', async () => {
      prisma.receivableInstallment.count.mockResolvedValue(0);
      prisma.payableInstallment.count.mockResolvedValue(0);
      prisma.receivable.findMany.mockResolvedValue([]);
      prisma.payable.findMany.mockResolvedValue([]);
      prisma.deliverySchedule.updateMany.mockResolvedValue({ count: 0 });
      prisma.order.update.mockResolvedValue({
        id: mockOrderId,
        status: OrderStatus.CANCELED,
      });

      const result = await service.cancelOrder(mockOrderId, {}, mockSellerId);

      expect(result.order.status).toBe(OrderStatus.CANCELED);
    });
  });

  describe('remove', () => {
    it('should soft-delete order by setting isActive to false', async () => {
      prisma.order.update.mockResolvedValue({
        id: mockOrderId,
        isActive: false,
      });

      const result = await service.remove(mockOrderId);

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: mockOrderId },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });
  });
  describe('updateOrderInfo — série', () => {
    const newSeriesId = 'series-uuid-nova';
    const orderNaSerieAntiga = {
      id: mockOrderId,
      status: OrderStatus.PENDING,
      quotation: {
        id: mockQuotationId,
        clientId: 'client-1',
        sellerId: mockSellerId,
        contactId: null,
        companyId: mockCompanyId,
        subCompanyId: null,
        seriesId: 'series-uuid-antiga',
        quotationNumber: 38,
        series: { code: 'T1' },
        client: { name: 'Corpori' },
        seller: { name: 'Ana' },
        contact: null,
        deliveryInfo: null,
      },
    };

    beforeEach(() => {
      prisma.saleSeries = { findUnique: jest.fn(), update: jest.fn() };
      prisma.quotation = { update: jest.fn() };
      prisma.user = {
        findUnique: jest.fn().mockResolvedValue({ name: 'Ana' }),
      };
      prisma.orderHistory = { create: jest.fn() };
      prisma.order.findUnique.mockResolvedValue(orderNaSerieAntiga);
      jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
    });

    it('renumera a OS pela série nova e registra no histórico', async () => {
      prisma.saleSeries.findUnique.mockResolvedValue({
        id: newSeriesId,
        code: 'V1',
        companyId: mockCompanyId,
        isActive: true,
      });
      prisma.saleSeries.update.mockResolvedValue({ currentBudgetNumber: 12 });

      await service.updateOrderInfo(
        mockOrderId,
        { seriesId: newSeriesId },
        'user-1',
      );

      expect(prisma.quotation.update).toHaveBeenCalledWith({
        where: { id: mockQuotationId },
        data: { seriesId: newSeriesId, quotationNumber: 12 },
      });
      const history = prisma.orderHistory.create.mock.calls[0][0].data;
      expect(history.changes).toEqual({
        before: { serie: '38-T1' },
        after: { serie: '12-V1' },
      });
      expect(history.description).toContain('série');
    });

    it('não mexe na numeração quando a série não muda', async () => {
      await service.updateOrderInfo(
        mockOrderId,
        { seriesId: 'series-uuid-antiga' },
        'user-1',
      );

      expect(prisma.saleSeries.update).not.toHaveBeenCalled();
      expect(prisma.quotation.update).not.toHaveBeenCalled();
    });
  });

  describe('updateOrderInfo — ids do corpo', () => {
    // Antes, cliente, vendedor, responsável e endereço eram buscados só pelo
    // id e gravados na venda, mesmo sendo de outra empresa
    beforeEach(() => {
      for (const model of ['client', 'employee', 'contact', 'address']) {
        prisma[model] = { count: jest.fn(), findUnique: jest.fn() };
      }
      prisma.quotation = { update: jest.fn() };
      prisma.order.findUnique.mockResolvedValue({
        id: mockOrderId,
        status: OrderStatus.PENDING,
        quotation: {
          id: mockQuotationId,
          clientId: 'client-1',
          sellerId: mockSellerId,
          contactId: null,
          companyId: mockCompanyId,
          deliveryInfo: null,
        },
      });
    });

    it.each([
      [
        'cliente',
        { clientId: 'client-b' },
        'client',
        'Cliente não encontrado.',
        { companyId: mockCompanyId },
      ],
      [
        'vendedor',
        { sellerId: 'seller-b' },
        'employee',
        'Vendedor não encontrado.',
        { companyId: mockCompanyId },
      ],
      [
        'responsável',
        { contactId: 'contact-b' },
        'contact',
        'Responsável não encontrado.',
        {
          OR: [
            { client: { companyId: mockCompanyId } },
            { supplier: { companyId: mockCompanyId } },
          ],
        },
      ],
      [
        'endereço de entrega',
        { deliveryClientAddressId: 'address-b' },
        'address',
        'Endereço não encontrado.',
        { client: { companyId: mockCompanyId } },
      ],
    ])(
      '%s de outra empresa: 404, sem gravar nada',
      async (_label, dto: any, model: string, message: string, scope) => {
        prisma[model].count.mockResolvedValue(0);

        await expect(
          service.updateOrderInfo(mockOrderId, dto, 'user-1'),
        ).rejects.toThrow(new NotFoundException(message));
        expect(prisma[model].count).toHaveBeenCalledWith({
          where: { id: { in: Object.values(dto) }, ...scope },
        });
        expect(prisma.quotation.update).not.toHaveBeenCalled();
      },
    );

    it('endereço personalizado não é id de endereço e não é conferido', async () => {
      await service
        .updateOrderInfo(
          mockOrderId,
          { deliveryClientAddressId: 'custom' } as any,
          'user-1',
        )
        .catch(() => undefined);

      expect(prisma.address.count).not.toHaveBeenCalled();
    });
  });
});
