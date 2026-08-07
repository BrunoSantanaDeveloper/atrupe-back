import { Test, TestingModule } from '@nestjs/testing';
import { QuotationCrudService } from './quotation-crud.service';
import { PrismaService } from 'nestjs-prisma';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QuotationStatus } from '@prisma/client';

const mockCompanyId = 'company-uuid-123';
const mockQuotationId = 'quotation-uuid-456';
const mockSellerId = 'seller-uuid-789';
const mockSeriesId = 'series-uuid-404';

const mockSeries = {
  id: mockSeriesId,
  currentBudgetNumber: 100,
  deliveryDeadline: 7,
  billing: 'ON_ORDER',
};

const mockCompany = {
  id: mockCompanyId,
  principalCompanyId: null,
};

const mockPaymentCondition = {
  id: 'payment-condition-uuid',
  companyId: mockCompanyId,
  isActive: true,
};

const mockQuotation = {
  id: mockQuotationId,
  companyId: mockCompanyId,
  status: QuotationStatus.OPEN,
  description: 'Test Quotation',
  isActive: true,
  sellerId: mockSellerId,
  totalValue: 10000,
  createdAt: new Date(),
  updatedAt: new Date(),
  dueDate: null,
  finishedAt: null,
  quickSale: false,
  quotationNumber: 101,
  order: null,
  series: null,
  seller: null,
  contact: null,
  contactSource: null,
  subCompany: null,
  client: null,
  deliveryInfo: null,
  quotationPayment: null,
  quotationProduct: [],
};

const createMockPrismaService = () => {
  const prisma = {
    quotation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    saleSeries: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    company: {
      findUnique: jest.fn(),
    },
    contact: {
      findFirst: jest.fn(),
    },
    deliveryInfo: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    deliverySchedule: {
      updateMany: jest.fn(),
    },
    paymentCondition: {
      findFirst: jest.fn(),
    },
    quotationPayment: {
      create: jest.fn(),
      update: jest.fn(),
    },
    quotationProduct: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    quotationProductItem: {
      create: jest.fn(),
    },
    contactSource: {
      findMany: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
  };

  return {
    ...prisma,
    $transaction: jest.fn((callback) => callback(prisma)),
  };
};

describe('QuotationCrudService', () => {
  let service: QuotationCrudService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationCrudService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<QuotationCrudService>(QuotationCrudService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a quotation successfully', async () => {
      prisma.saleSeries.findUnique.mockResolvedValue(mockSeries);
      prisma.company.findUnique.mockResolvedValue(mockCompany);
      prisma.quotation.create.mockResolvedValue(mockQuotation);
      prisma.saleSeries.update.mockResolvedValue(mockSeries);
      prisma.deliveryInfo.create.mockResolvedValue({});
      prisma.paymentCondition.findFirst.mockResolvedValue(mockPaymentCondition);
      prisma.quotationPayment.create.mockResolvedValue({});

      const result = await service.create({
        companyId: mockCompanyId,
        sellerId: mockSellerId,
        seriesId: mockSeriesId,
        clientId: 'client-uuid',
        subCompanyId: null,
        quotationNumber: 100,
      });

      expect(result).toBeDefined();
      expect(result.id).toBe(mockQuotationId);
      expect(prisma.quotation.create).toHaveBeenCalled();
    });

    it('should throw BadRequestException if seriesId is missing', async () => {
      await expect(
        service.create({
          companyId: mockCompanyId,
          sellerId: mockSellerId,
          seriesId: undefined,
          clientId: 'client-uuid',
          subCompanyId: null,
          quotationNumber: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if series not found', async () => {
      prisma.saleSeries.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          companyId: mockCompanyId,
          sellerId: mockSellerId,
          seriesId: mockSeriesId,
          clientId: 'client-uuid',
          subCompanyId: null,
          quotationNumber: 100,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('should return quotation when found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(mockQuotation);

      const result = await service.findOne(mockQuotationId);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockQuotationId);
    });

    it('should throw NotFoundException when quotation not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated quotations', async () => {
      prisma.quotation.findMany.mockResolvedValue([mockQuotation]);
      prisma.quotation.count.mockResolvedValue(1);

      const result = await service.findAll({
        companyId: mockCompanyId,
        page: '1',
        limit: '10',
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by status', async () => {
      prisma.quotation.findMany.mockResolvedValue([]);
      prisma.quotation.count.mockResolvedValue(0);

      await service.findAll({
        companyId: mockCompanyId,
        status: QuotationStatus.DONE,
        page: '1',
        limit: '10',
      });

      expect(prisma.quotation.findMany).toHaveBeenCalled();
    });
  });

  describe('findAllQuantity', () => {
    it('should return count by status', async () => {
      prisma.quotation.findMany.mockResolvedValue([
        { ...mockQuotation, status: 'OPEN', dueDate: null },
        { ...mockQuotation, status: 'DONE', dueDate: new Date() },
      ]);

      const result = await service.findAllQuantity(mockCompanyId);

      expect(result).toHaveProperty('OPEN');
      expect(result).toHaveProperty('DONE');
      expect(result).toHaveProperty('TOTAL');
    });
  });

  describe('update', () => {
    it('should update quotation successfully', async () => {
      prisma.quotation.findUnique.mockResolvedValue(mockQuotation);
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        description: 'Updated',
      });

      const result = await service.update(mockQuotationId, {
        description: 'Updated',
      });

      expect(result.description).toBe('Updated');
    });

    it('should throw NotFoundException if quotation not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(null);

      await expect(
        service.update('invalid-id', { description: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft delete quotation', async () => {
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        isActive: false,
      });

      const result = await service.remove(mockQuotationId);

      expect(result.isActive).toBe(false);
      expect(prisma.quotation.update).toHaveBeenCalledWith({
        where: { id: mockQuotationId },
        data: { isActive: false },
      });
    });
  });

  describe('count', () => {
    it('should return total count with companyId', async () => {
      prisma.quotation.count.mockResolvedValue(42);

      const result = await service.count(mockCompanyId);

      expect(result).toBe(42);
      expect(prisma.quotation.count).toHaveBeenCalledWith({
        where: { companyId: mockCompanyId },
      });
    });
  });

  describe('findAllContactSources', () => {
    it('should return contact sources', async () => {
      const mockSources = [
        { id: '1', name: 'Website' },
        { id: '2', name: 'Indicação' },
      ];
      prisma.contactSource.findMany.mockResolvedValue(mockSources);

      const result = await service.findAllContactSources();

      expect(result).toEqual(mockSources);
    });
  });

  describe('duplicate', () => {
    const buildProduct = (name: string) => ({
      productId: `product-${name}`,
      description: name,
      quantity: 1,
      technicalDescription: null,
      imageUrl: null,
      notes: null,
      totalValue: 100,
      finalValue: 100,
      discount: null,
      discountType: null,
      allowEditDescription: true,
      allowEditValues: true,
      items: [
        { productItemId: `item-${name}-1`, name: `${name} 1`, quantity: 1 },
        { productItemId: `item-${name}-2`, name: `${name} 2`, quantity: 1 },
      ],
    });

    beforeEach(() => {
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        seriesId: mockSeriesId,
        clientId: 'client-uuid',
        contactId: null,
        contactSourceId: null,
        subCompanyId: null,
        deliveryInfo: {},
        quotationPayment: {},
        quotationProduct: [
          buildProduct('A'),
          buildProduct('B'),
          buildProduct('C'),
        ],
      });
      prisma.saleSeries.update.mockResolvedValue({ currentBudgetNumber: 102 });
      prisma.quotation.create.mockResolvedValue({ id: 'new-quotation-uuid' });
      prisma.deliveryInfo.create.mockResolvedValue({});
      prisma.quotationPayment.create.mockResolvedValue({});
      prisma.quotationProduct.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: `new-${data.description}`, ...data }),
      );
      prisma.quotationProductItem.create.mockResolvedValue({});
      prisma.quotationProduct.findMany.mockResolvedValue([]);
      prisma.quotation.update.mockResolvedValue({});
      prisma.quotationPayment.update.mockResolvedValue({});
    });

    it('should read the original products and items ordered by createdAt', async () => {
      await service.duplicate(mockQuotationId, {});

      const include = prisma.quotation.findUnique.mock.calls[0][0].include;
      expect(include.quotationProduct.orderBy).toEqual({ createdAt: 'asc' });
      expect(include.quotationProduct.include.items.orderBy).toEqual({
        createdAt: 'asc',
      });
    });

    it('should keep the original item order with strictly increasing createdAt', async () => {
      await service.duplicate(mockQuotationId, {});

      const created = prisma.quotationProduct.create.mock.calls.map(
        ([{ data }]) => data,
      );

      expect(created.map((p) => p.description)).toEqual(['A', 'B', 'C']);

      const timestamps = [
        ...created,
        ...prisma.quotationProductItem.create.mock.calls.map(
          ([{ data }]) => data,
        ),
      ].map((record) => record.createdAt.getTime());

      expect(timestamps).toHaveLength(9);
      expect(new Set(timestamps).size).toBe(timestamps.length);
      created.forEach((product, index) => {
        if (index === 0) return;
        expect(product.createdAt.getTime()).toBeGreaterThan(
          created[index - 1].createdAt.getTime(),
        );
      });
    });
  });

  describe('getUserIdFromEmployee', () => {
    it('should return userId from employee', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        userId: 'user-uuid',
        name: 'John Doe',
        user: { name: 'John' },
      });

      const result = await service.getUserIdFromEmployee('employee-uuid');

      expect(result).toEqual({
        userId: 'user-uuid',
        userName: 'John Doe',
      });
    });

    it('should return null if employee has no userId', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        userId: null,
        name: 'John Doe',
      });

      const result = await service.getUserIdFromEmployee('employee-uuid');

      expect(result).toBeNull();
    });
  });
});
