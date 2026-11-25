import { Test, TestingModule } from '@nestjs/testing';
import { QuotationFinancialService } from './quotation-financial.service';
import { PrismaService } from 'nestjs-prisma';

const mockCompanyId = 'company-uuid-123';

const mockNature = {
  id: 'nature-uuid',
  name: 'Vendas',
};

const mockSubCategory = {
  id: 'subcategory-uuid',
  name: 'Prestação de Serviços',
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
    create: jest.fn(),
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

  describe('generateReceivableFromQuotation', () => {
    beforeEach(() => {
      prisma.nature.findFirst.mockResolvedValue(mockNature);
      prisma.subCategory.findFirst.mockResolvedValue(mockSubCategory);
      prisma.bankAccount.findFirst.mockResolvedValue({ id: 'bank-account-id' });
      prisma.receivable.create.mockResolvedValue({ id: 'receivable-id' });
      prisma.receivableInstallment.createMany.mockResolvedValue({ count: 1 });
    });

    it('should preserve quotation payment discount when syncing stale installments', async () => {
      const quotation = {
        id: 'quotation-id',
        companyId: mockCompanyId,
        clientId: 'client-id',
        quotationNumber: 28,
        description: null,
        totalValue: 12000,
        series: { code: 'T1' },
        deliveryInfo: { value: 0 },
        quotationPayment: {
          billing: 'ON_ORDER',
          totalValue: 11000,
          finalValue: 11000,
          discountTotal: 1000,
          quotationInstallment: [
            {
              id: 'installment-id',
              value: 12000,
              additionalFee: 0,
              dueDate: new Date('2026-07-03'),
              paymentConditionId: 'payment-condition-id',
            },
          ],
          commission: null,
          downPayment: 0,
          downPaymentDueDate: null,
          downPaymentAdditionalFee: 0,
          description: '',
          downPaymentConditionId: null,
        },
      };

      await service.generateReceivableFromQuotation(
        quotation as any,
        prisma as any,
      );

      expect(prisma.receivable.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          totalAmount: 11000,
          totalValue: 11000,
        }),
      });
      expect(prisma.receivableInstallment.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            amount: 11000,
          }),
        ],
      });
    });

    it('à vista integral: só o título da entrada, sem título principal vazio', async () => {
      // Lista Lite 24/11, item 1: a venda inteira na entrada, sem parcelas
      prisma.receivable.create.mockResolvedValue({ id: 'down-payment-id' });
      const quotation = {
        id: 'quotation-id',
        companyId: mockCompanyId,
        clientId: 'client-id',
        quotationNumber: 40,
        description: null,
        totalValue: 20000,
        series: { code: 'T1' },
        deliveryInfo: { value: 0 },
        quotationPayment: {
          billing: 'ON_ORDER',
          totalValue: 20000,
          finalValue: 20000,
          discountTotal: 0,
          quotationInstallment: [],
          commission: null,
          downPayment: 20000,
          downPaymentDueDate: new Date('2026-11-25T12:00:00.000Z'),
          downPaymentAdditionalFee: 0,
          description: '',
          downPaymentConditionId: 'payment-condition-id',
        },
      };

      const result = await service.generateReceivableFromQuotation(
        quotation as any,
        prisma as any,
      );

      expect(prisma.receivable.create).toHaveBeenCalledTimes(1);
      expect(prisma.receivable.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ financialType: 'DOWN_PAYMENT' }),
      });
      expect(result).toEqual({ id: 'down-payment-id' });
    });

    it('à vista integral: na liberação da pendência não há mais nada a gerar', async () => {
      const quotation = {
        id: 'quotation-id',
        companyId: mockCompanyId,
        quotationPayment: {
          quotationInstallment: [],
          downPayment: 20000,
          downPaymentDueDate: new Date('2026-11-25T12:00:00.000Z'),
          downPaymentAdditionalFee: 0,
          downPaymentConditionId: 'payment-condition-id',
        },
      };

      const result = await service.generateReceivableFromQuotation(
        quotation as any,
        prisma as any,
        { skipDownPayment: true },
      );

      expect(result).toBeNull();
      expect(prisma.receivable.create).not.toHaveBeenCalled();
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
