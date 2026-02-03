import { Test, TestingModule } from '@nestjs/testing';
import { QuotationService } from './quotation.service';
import { PrismaService } from 'nestjs-prisma';
import { OrderService } from '../order/order.service';
import { DeliveryScheduleService } from '../delivery-schedule/delivery-schedule.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QuotationStatus, OrderStatus } from '@prisma/client';

// Mock data
const mockCompanyId = 'company-uuid-123';
const mockQuotationId = 'quotation-uuid-456';
const mockOrderId = 'order-uuid-789';
const mockClientId = 'client-uuid-101';
const mockUserId = 'user-uuid-202';
const mockDeliveryInfoId = 'delivery-info-uuid-303';

const mockClient = {
  id: mockClientId,
  name: 'Cliente Teste',
  status: 'ACTIVE',
  document: '12345678901',
};

const mockClientInactive = {
  ...mockClient,
  status: 'INACTIVE',
};

const mockDeliveryInfo = {
  id: mockDeliveryInfoId,
  estimatedDate: new Date(),
  daysAfterApproval: 7,
  cost: 0,
  supplierId: null,
  deliveryType: 'DELIVERY',
};

const mockQuotationPayment = {
  billing: 'ON_DELIVERY', // Changed to skip financial generation in most tests
  quotationInstallment: [],
  commission: 0,
  downPayment: 0,
  downPaymentDueDate: null,
  downPaymentAdditionalFee: 0,
  description: null,
  downPaymentConditionId: null,
};

const mockSeries = {
  id: 'series-uuid-404',
  title: 'Série Padrão',
  code: 'SP',
  productionStatus: 'IN_PRODUCTION',
};

const mockQuotation = {
  id: mockQuotationId,
  companyId: mockCompanyId,
  status: QuotationStatus.OPEN,
  approvedAt: null,
  deliveryInfo: mockDeliveryInfo,
  quotationPayment: mockQuotationPayment,
  quotationProduct: [],
  client: mockClient,
  series: mockSeries,
};

const mockOrder = {
  id: mockOrderId,
  quotationId: mockQuotationId,
  status: OrderStatus.IN_PRODUCTION,
};

const mockAdminUser = {
  id: mockUserId,
  employee: [
    {
      role: { name: 'Admin' },
    },
  ],
};

const mockRegularUser = {
  id: mockUserId,
  employee: [
    {
      role: { name: 'Vendedor' },
    },
  ],
};

const mockSellerWithPermission = {
  canApprovePreRegistration: true,
};

const mockActiveSubscription = {
  plan: { planType: 'STANDARD' },
  nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
};

const mockTrialSubscription = {
  plan: { planType: 'TRIAL' },
  nextDueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
};

// Mock Prisma with transaction support
const createMockPrismaService = () => {
  const mockTransaction = jest.fn();

  const prismaBase = {
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
    user: {
      findUnique: jest.fn(),
    },
    sellerProfile: {
      findFirst: jest.fn(),
    },
    deliveryInfo: {
      update: jest.fn(),
    },
    deliverySchedule: {
      create: jest.fn(),
    },
    receivable: {
      findMany: jest.fn(),
    },
    payable: {
      findMany: jest.fn(),
    },
    $transaction: mockTransaction,
  };

  return prismaBase;
};

const mockOrderService = {
  create: jest.fn(),
  findOne: jest.fn(),
};

const mockDeliveryScheduleService = {
  create: jest.fn(),
};

describe('QuotationService', () => {
  let service: QuotationService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrderService, useValue: mockOrderService },
        {
          provide: DeliveryScheduleService,
          useValue: mockDeliveryScheduleService,
        },
      ],
    }).compile();

    service = module.get<QuotationService>(QuotationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('approve', () => {
    beforeEach(() => {
      // Default mock setup for successful approval
      prisma.quotation.findUnique.mockResolvedValue({
        id: mockQuotationId,
        companyId: mockCompanyId,
      });

      prisma.company.findUnique.mockResolvedValue({
        id: mockCompanyId,
        Subscription: [mockActiveSubscription],
      });

      // Mock transaction to execute the callback and return order
      prisma.$transaction.mockImplementation(async (callback) => {
        // Create a mock transaction client with same methods
        const transactionClient = {
          quotation: {
            update: jest.fn().mockResolvedValue({
              ...mockQuotation,
              status: QuotationStatus.APPROVED,
              approvedAt: new Date(),
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockAdminUser),
          },
          sellerProfile: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockOrder),
          },
          deliveryInfo: {
            update: jest.fn().mockResolvedValue(mockDeliveryInfo),
          },
          deliverySchedule: {
            create: jest.fn().mockResolvedValue({}),
          },
          receivable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          payable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };

        const result = await callback(transactionClient);
        return result;
      });
    });

    it('should approve quotation and create order', async () => {
      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockOrderId);
      expect(result.quotationId).toBe(mockQuotationId);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException if quotation not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(null);

      await expect(service.approve('invalid-id', mockUserId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if client inactive without permission', async () => {
      prisma.$transaction.mockImplementation(async (callback) => {
        const transactionClient = {
          quotation: {
            update: jest.fn().mockResolvedValue({
              ...mockQuotation,
              client: mockClientInactive,
              status: QuotationStatus.APPROVED,
              approvedAt: new Date(),
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockRegularUser),
          },
          sellerProfile: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockOrder),
          },
          deliveryInfo: {
            update: jest.fn().mockResolvedValue(mockDeliveryInfo),
          },
          deliverySchedule: {
            create: jest.fn().mockResolvedValue({}),
          },
          receivable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          payable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };

        return callback(transactionClient);
      });

      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow approval if user is Admin even with inactive client', async () => {
      prisma.$transaction.mockImplementation(async (callback) => {
        const transactionClient = {
          quotation: {
            update: jest.fn().mockResolvedValue({
              ...mockQuotation,
              client: mockClientInactive,
              status: QuotationStatus.APPROVED,
              approvedAt: new Date(),
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockAdminUser),
          },
          sellerProfile: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockOrder),
          },
          deliveryInfo: {
            update: jest.fn().mockResolvedValue(mockDeliveryInfo),
          },
          deliverySchedule: {
            create: jest.fn().mockResolvedValue({}),
          },
          receivable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          payable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };

        return callback(transactionClient);
      });

      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockOrderId);
    });

    it('should throw Error if deliveryInfo is missing', async () => {
      prisma.$transaction.mockImplementation(async (callback) => {
        const transactionClient = {
          quotation: {
            update: jest.fn().mockResolvedValue({
              ...mockQuotation,
              deliveryInfo: null, // Missing delivery info
              status: QuotationStatus.APPROVED,
              approvedAt: new Date(),
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockAdminUser),
          },
          sellerProfile: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockOrder),
          },
          deliveryInfo: {
            update: jest.fn().mockResolvedValue(mockDeliveryInfo),
          },
          deliverySchedule: {
            create: jest.fn().mockResolvedValue({}),
          },
          receivable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          payable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };

        return callback(transactionClient);
      });

      await expect(
        service.approve(mockQuotationId, mockUserId),
      ).rejects.toThrow('Informações de entrega ausentes na venda.');
    });

    it('should return existing order if already exists', async () => {
      const existingOrder = { ...mockOrder, status: OrderStatus.FINISHED };

      prisma.$transaction.mockImplementation(async (callback) => {
        const transactionClient = {
          quotation: {
            update: jest.fn().mockResolvedValue({
              ...mockQuotation,
              status: QuotationStatus.APPROVED,
              approvedAt: new Date(),
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockAdminUser),
          },
          sellerProfile: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          order: {
            findUnique: jest.fn().mockResolvedValue(existingOrder), // Order already exists
            create: jest.fn(),
          },
          deliveryInfo: {
            update: jest.fn().mockResolvedValue(mockDeliveryInfo),
          },
          deliverySchedule: {
            create: jest.fn().mockResolvedValue({}),
          },
          receivable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          payable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };

        return callback(transactionClient);
      });

      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockOrderId);
    });

    it('should set delivery status to DELIVERING for trial companies', async () => {
      let deliveryScheduleData: any = null;

      prisma.company.findUnique.mockResolvedValue({
        id: mockCompanyId,
        Subscription: [mockTrialSubscription],
      });

      prisma.$transaction.mockImplementation(async (callback) => {
        const transactionClient = {
          quotation: {
            update: jest.fn().mockResolvedValue({
              ...mockQuotation,
              status: QuotationStatus.APPROVED,
              approvedAt: new Date(),
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockAdminUser),
          },
          sellerProfile: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockOrder),
          },
          deliveryInfo: {
            update: jest.fn().mockResolvedValue(mockDeliveryInfo),
          },
          deliverySchedule: {
            create: jest.fn().mockImplementation((data) => {
              deliveryScheduleData = data;
              return Promise.resolve({});
            }),
          },
          receivable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          payable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };

        return callback(transactionClient);
      });

      await service.approve(mockQuotationId, mockUserId);

      expect(deliveryScheduleData).not.toBeNull();
      expect(deliveryScheduleData.data.status).toBe('DELIVERING');
    });

    it('should allow seller with canApprovePreRegistration to approve inactive client', async () => {
      prisma.$transaction.mockImplementation(async (callback) => {
        const transactionClient = {
          quotation: {
            update: jest.fn().mockResolvedValue({
              ...mockQuotation,
              client: mockClientInactive,
              status: QuotationStatus.APPROVED,
              approvedAt: new Date(),
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockRegularUser),
          },
          sellerProfile: {
            findFirst: jest.fn().mockResolvedValue(mockSellerWithPermission),
          },
          order: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockOrder),
          },
          deliveryInfo: {
            update: jest.fn().mockResolvedValue(mockDeliveryInfo),
          },
          deliverySchedule: {
            create: jest.fn().mockResolvedValue({}),
          },
          receivable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          payable: {
            findMany: jest.fn().mockResolvedValue([]),
          },
        };

        return callback(transactionClient);
      });

      const result = await service.approve(mockQuotationId, mockUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockOrderId);
    });
  });
});
