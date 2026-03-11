import { Test, TestingModule } from '@nestjs/testing';
import { QuotationWorkflowService } from './quotation-workflow.service';
import { QuotationFinancialService } from './quotation-financial.service';
import { PrismaService } from 'nestjs-prisma';
import { DeliveryScheduleService } from '../delivery-schedule/delivery-schedule.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QuotationStatus, OrderStatus } from '@prisma/client';

const mockCompanyId = 'company-uuid-123';
const mockQuotationId = 'quotation-uuid-456';
const mockOrderId = 'order-uuid-789';
const mockUserId = 'user-uuid-101';
const mockUserName = 'Test User';

const mockOrder = {
  id: mockOrderId,
  quotationId: mockQuotationId,
  status: OrderStatus.IN_PRODUCTION,
};

const mockQuotation = {
  id: mockQuotationId,
  companyId: mockCompanyId,
  status: QuotationStatus.OPEN,
  totalValue: 10000,
};

const mockActiveSubscription = {
  plan: { planType: 'FULL' },
  nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
};

const createMockPrismaService = () => ({
  quotation: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  company: {
    findUnique: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  deliveryInfo: {
    update: jest.fn(),
  },
  deliverySchedule: {
    create: jest.fn(),
    update: jest.fn(),
  },
  receivable: {
    findMany: jest.fn(),
  },
  payable: {
    findMany: jest.fn(),
  },
  reasons: {
    findFirst: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
  },
  productionStage: {
    createMany: jest.fn(),
  },
  companySector: {
    findFirst: jest.fn(),
  },
  user: {
    findUnique: jest.fn().mockResolvedValue({ name: mockUserName }),
  },
  quotationHistory: {
    create: jest.fn(),
  },
  orderHistory: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
});

const mockFinancialService = {
  generateReceivableFromQuotation: jest.fn(),
  generatePayableFromQuotation: jest.fn(),
};

const mockDeliveryScheduleService = {
  create: jest.fn(),
};

describe('QuotationWorkflowService', () => {
  let service: QuotationWorkflowService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationWorkflowService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: QuotationFinancialService,
          useValue: mockFinancialService,
        },
        {
          provide: DeliveryScheduleService,
          useValue: mockDeliveryScheduleService,
        },
      ],
    }).compile();

    service = module.get<QuotationWorkflowService>(QuotationWorkflowService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('approve', () => {
    beforeEach(() => {
      prisma.quotation.findUnique.mockResolvedValue({
        id: mockQuotationId,
        companyId: mockCompanyId,
      });
      prisma.company.findUnique.mockResolvedValue({
        id: mockCompanyId,
        Subscription: [mockActiveSubscription],
      });
    });

    it('should approve quotation and create order', async () => {
      prisma.$transaction.mockImplementation(async (callback) => {
        const transactionClient = {
          quotation: {
            update: jest.fn().mockResolvedValue({
              ...mockQuotation,
              status: QuotationStatus.APPROVED,
              approvedAt: new Date(),
              deliveryInfo: { id: 'delivery-info-id', daysAfterApproval: 7 },
              quotationPayment: { billing: 'ON_DELIVERY' },
              client: { status: 'ACTIVE' },
              series: { productionStatus: 'IN_PRODUCTION' },
            }),
          },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
          sellerProfile: { findFirst: jest.fn().mockResolvedValue(null) },
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockOrder),
          },
          deliveryInfo: { update: jest.fn() },
          deliverySchedule: { create: jest.fn() },
          receivable: { findMany: jest.fn().mockResolvedValue([]) },
          payable: { findMany: jest.fn().mockResolvedValue([]) },
        };
        return callback(transactionClient);
      });

      // Mock for createProductionStages
      prisma.quotation.findUnique.mockResolvedValueOnce({
        id: mockQuotationId,
        companyId: mockCompanyId,
      });
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        quotationProduct: [],
        deliveryInfo: null,
      });
      prisma.product.findMany.mockResolvedValue([]);

      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockOrderId);

      // Verify history was created
      expect(prisma.quotationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quotationId: mockQuotationId,
          action: 'APPROVED',
          createdBy: mockUserId,
        }),
      });
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: mockOrderId,
          action: 'CREATED',
          createdBy: mockUserId,
        }),
      });
    });

    it('should throw NotFoundException if quotation not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(null);

      await expect(service.approve('invalid-id', mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('should reject quotation successfully', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.DONE,
      });
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.REJECTED,
      });

      const result = await service.reject(mockQuotationId, {}, mockUserId);

      expect(result.status).toBe(QuotationStatus.REJECTED);

      // Verify history was created
      expect(prisma.quotationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quotationId: mockQuotationId,
          action: 'REJECTED',
          createdBy: mockUserId,
        }),
      });
    });

    it('should throw BadRequestException if quotation is approved', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.APPROVED,
      });

      await expect(
        service.reject(mockQuotationId, {}, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if quotation not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(null);

      await expect(
        service.reject('invalid-id', {}, mockUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('open', () => {
    it('should reopen quotation successfully', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.REJECTED,
      });
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.OPEN,
      });

      const result = await service.open(mockQuotationId, mockUserId);

      expect(result.status).toBe(QuotationStatus.OPEN);

      // Verify history was created
      expect(prisma.quotationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quotationId: mockQuotationId,
          action: 'REOPENED',
          createdBy: mockUserId,
        }),
      });
    });

    it('should throw BadRequestException if quotation is approved', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.APPROVED,
      });

      await expect(service.open(mockQuotationId, mockUserId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('finish', () => {
    it('should finish quotation successfully', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.OPEN,
        seller: {
          sellerProfile: { minValue: 0, maxDiscount: 50 },
        },
        quotationPayment: {
          billing: 'ON_ORDER',
          quotationInstallment: [{}],
          finalValue: 10000,
        },
        quotationProduct: [],
        series: { proposalValidity: 30 },
      });
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.DONE,
        finishedAt: new Date(),
      });

      const result = await service.finish(mockQuotationId, mockUserId);

      expect(result.status).toBe(QuotationStatus.DONE);

      // Verify history was created
      expect(prisma.quotationHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quotationId: mockQuotationId,
          action: 'FINISHED',
          createdBy: mockUserId,
        }),
      });
    });

    it('should throw BadRequestException if approved', async () => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        status: QuotationStatus.APPROVED,
      });

      await expect(service.finish(mockQuotationId, mockUserId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('billQuotation', () => {
    it('should skip if financials already exist', async () => {
      prisma.$transaction.mockResolvedValue({
        receivables: [{ id: 'existing-receivable' }],
        payables: [],
      });

      const result = await service.billQuotation(mockQuotationId);

      expect(result).toBeDefined();
    });
  });
});
