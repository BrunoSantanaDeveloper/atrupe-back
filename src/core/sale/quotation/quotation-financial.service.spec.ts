import { Test, TestingModule } from '@nestjs/testing';
import { QuotationFinancialService } from './quotation-financial.service';
import { PrismaService } from 'nestjs-prisma';

const mockCompanyId = 'company-uuid-123';
const mockQuotationId = 'quotation-uuid-456';

const mockQuotation = {
  id: mockQuotationId,
  companyId: mockCompanyId,
  totalValue: 100000,
  quotationPayment: {
    billing: 'ON_ORDER',
    totalValue: 100000,
    finalValue: 100000,
    downPayment: 10000,
    downPaymentDueDate: new Date(),
    commission: 5,
    quotationInstallment: [
      { id: '1', dueDate: new Date(), value: 45000 },
      { id: '2', dueDate: new Date(), value: 45000 },
    ],
  },
  deliveryInfo: {
    cost: 5000,
    supplierId: 'supplier-uuid',
    deliveryType: 'CARRIER',
  },
  client: { id: 'client-uuid', name: 'Test Client' },
};

const mockNature = {
  id: 'nature-uuid',
  name: 'Vendas',
};

const mockSubCategory = {
  id: 'subcategory-uuid',
  name: 'Prestação de Serviços',
};

const mockBankAccount = {
  id: 'bank-account-uuid',
  name: 'Conta Principal',
};

const createMockPrismaService = () => ({
  nature: {
    findFirst: jest.fn(),
  },
  subCategory: {
    findFirst: jest.fn(),
  },
  bankAccount: {
    findFirst: jest.fn(),
  },
  receivable: {
    create: jest.fn(),
  },
  receivableInstallment: {
    createMany: jest.fn(),
  },
  payable: {
    create: jest.fn(),
  },
  payableInstallment: {
    create: jest.fn(),
  },
  sellerProfile: {
    findFirst: jest.fn(),
  },
  paymentMethod: {
    findMany: jest.fn(),
  },
  paymentCondition: {
    findMany: jest.fn(),
  },
  client: {
    findUnique: jest.fn(),
  },
});

describe('QuotationFinancialService', () => {
  let service: QuotationFinancialService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationFinancialService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<QuotationFinancialService>(QuotationFinancialService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findSalesCategories', () => {
    it('should find sales nature and subcategory', async () => {
      prisma.nature.findFirst.mockResolvedValue(mockNature);
      prisma.subCategory.findFirst.mockResolvedValue(mockSubCategory);

      const result = await service.findSalesCategories(
        mockCompanyId,
        prisma as any,
      );

      expect(result).toEqual({
        natureId: mockNature.id,
        subCategoryId: mockSubCategory.id,
      });
    });

    it('should return null subCategoryId if not found', async () => {
      prisma.nature.findFirst.mockResolvedValue(mockNature);
      prisma.subCategory.findFirst.mockResolvedValue(null);

      const result = await service.findSalesCategories(
        mockCompanyId,
        prisma as any,
      );

      expect(result.subCategoryId).toBeNull();
    });
  });

  describe('findCommissionCategories', () => {
    it('should find commission nature and subcategory', async () => {
      prisma.nature.findFirst.mockResolvedValue({
        id: 'operacional-uuid',
        name: 'Operacional',
      });
      prisma.subCategory.findFirst.mockResolvedValue({
        id: 'commission-subcategory-uuid',
        name: 'Comissão de Venda',
      });

      const result = await service.findCommissionCategories(
        mockCompanyId,
        prisma as any,
      );

      expect(result).toBeDefined();
      expect(result.natureId).toBe('operacional-uuid');
    });
  });

  describe('findDeliveryCategories', () => {
    it('should find delivery nature and subcategory', async () => {
      prisma.nature.findFirst.mockResolvedValue({
        id: 'operacional-uuid',
        name: 'Operacional',
      });
      prisma.subCategory.findFirst.mockResolvedValue({
        id: 'delivery-subcategory-uuid',
        name: 'Frete de Venda',
      });

      const result = await service.findDeliveryCategories(
        mockCompanyId,
        prisma as any,
      );

      expect(result).toBeDefined();
      expect(result.natureId).toBe('operacional-uuid');
    });
  });

  describe('getAvailablePaymentMethods', () => {
    it('should return payment methods for company', async () => {
      prisma.paymentMethod.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'PIX',
          maxInstallments: 1,
          paymentCondition: [{ id: 'pc1', name: 'PIX 1x', maxInstallments: 1 }],
        },
      ]);

      const result = await service.getAvailablePaymentMethods(mockCompanyId);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should filter by client payment conditions', async () => {
      prisma.paymentMethod.findMany.mockResolvedValue([
        {
          id: '1',
          name: 'PIX',
          maxInstallments: 1,
          paymentCondition: [{ id: 'pc1', name: 'PIX 1x', maxInstallments: 1 }],
        },
      ]);
      prisma.client.findUnique.mockResolvedValue({
        id: 'client-uuid',
        type: 'J',
        status: 'ACTIVE',
        maxValue: null,
        minValue: null,
        paymentConditions: [
          {
            isActive: true,
            paymentCondition: {
              id: 'pc1',
              name: 'PIX 1x',
              paymentMethod: { id: '1', name: 'PIX' },
            },
          },
        ],
      });

      const result = await service.getAvailablePaymentMethods(
        mockCompanyId,
        'client-uuid',
      );

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('shouldCreateCommissionPayable', () => {
    it('should return false if no commission', async () => {
      const result = await service.shouldCreateCommissionPayable(
        null,
        prisma as any,
      );
      expect(result).toBe(false);
    });

    it('should return false if commission is 0', async () => {
      const result = await service.shouldCreateCommissionPayable(
        0 as any,
        prisma as any,
      );
      expect(result).toBe(false);
    });
  });

  describe('shouldCreateDeliveryPayable', () => {
    it('should return false if no delivery info', () => {
      const result = service.shouldCreateDeliveryPayable(null);
      expect(result).toBe(false);
    });

    it('should return false if cost is 0', () => {
      const result = service.shouldCreateDeliveryPayable({
        cost: 0,
        supplierId: 'supplier-uuid',
      } as any);
      expect(result).toBe(false);
    });

    it('should return true if delivery has cost and supplier', () => {
      const result = service.shouldCreateDeliveryPayable({
        cost: 5000,
        supplierId: 'supplier-uuid',
      } as any);
      expect(result).toBe(true);
    });
  });
});
