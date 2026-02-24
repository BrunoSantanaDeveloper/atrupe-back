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
const mockReasonId = 'reason-uuid-202';

const createMockPrismaService = () => {
  const mock: any = {
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

  describe('create', () => {
    it('should create an order with PENDING status', async () => {
      const mockOrder = {
        id: mockOrderId,
        quotationId: mockQuotationId,
        status: OrderStatus.PENDING,
      };
      prisma.order.create.mockResolvedValue(mockOrder);

      const result = await service.create({ quotationId: mockQuotationId });

      expect(result.status).toBe(OrderStatus.PENDING);
      expect(prisma.order.create).toHaveBeenCalledWith({
        data: {
          quotationId: mockQuotationId,
          status: OrderStatus.PENDING,
        },
      });
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
});
