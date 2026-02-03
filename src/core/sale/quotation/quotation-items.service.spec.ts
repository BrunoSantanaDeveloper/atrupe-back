import { Test, TestingModule } from '@nestjs/testing';
import { QuotationItemsService } from './quotation-items.service';
import { PrismaService } from 'nestjs-prisma';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QuotationStatus } from '@prisma/client';

const mockQuotationId = 'quotation-uuid-456';
const mockProductId = 'product-uuid-123';
const mockQuotationProductId = 'quotation-product-uuid-789';

const mockProduct = {
  id: mockProductId,
  name: 'Test Product',
  price: 10000,
  productItem: [
    { id: 'item-1', price: 5000, value: 5000 },
    { id: 'item-2', price: 5000, value: 5000 },
  ],
};

const mockQuotation = {
  id: mockQuotationId,
  status: QuotationStatus.OPEN,
  totalValue: 10000,
};

const mockQuotationProduct = {
  id: mockQuotationProductId,
  quotationId: mockQuotationId,
  productId: mockProductId,
  quantity: 1,
  totalValue: 10000,
  finalValue: 10000,
  discount: 0,
  discountType: null,
  quotation: mockQuotation,
  items: [
    {
      id: 'qp-item-1',
      name: 'Item 1',
      value: 5000,
      totalValue: 5000,
      salePrice: 5000,
      quantity: 1,
      originalQuantity: 1,
    },
    {
      id: 'qp-item-2',
      name: 'Item 2',
      value: 5000,
      totalValue: 5000,
      salePrice: 5000,
      quantity: 1,
      originalQuantity: 1,
    },
  ],
};

const createMockPrismaService = () => ({
  quotation: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
  },
  quotationProduct: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  quotationProductItem: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  quotationPayment: {
    update: jest.fn(),
  },
});

describe('QuotationItemsService', () => {
  let service: QuotationItemsService;
  let prisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationItemsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<QuotationItemsService>(QuotationItemsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addProductToQuotation', () => {
    it('should add product to quotation', async () => {
      prisma.quotation.findUnique.mockResolvedValue(mockQuotation);
      prisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        items: mockProduct.productItem,
      });
      prisma.quotationProduct.create.mockResolvedValue(mockQuotationProduct);
      prisma.quotationProductItem.createMany.mockResolvedValue({ count: 2 });
      prisma.quotation.update.mockResolvedValue(mockQuotation);
      prisma.quotationProduct.findMany.mockResolvedValue([
        mockQuotationProduct,
      ]);
      prisma.quotationPayment.update.mockResolvedValue({});

      const result = await service.addProductToQuotation(mockQuotationId, {
        productId: mockProductId,
        quantity: 1,
        items: [
          {
            id: 'item-1',
            quantity: 1,
            originalQuantity: 1,
            salePrice: 5000,
            totalValue: 5000,
          },
        ] as any,
      });

      expect(result).toBeDefined();
      expect(prisma.quotationProduct.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if quotation not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(null);

      await expect(
        service.addProductToQuotation(mockQuotationId, {
          productId: mockProductId,
          quantity: 1,
          items: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if product not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(mockQuotation);
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.addProductToQuotation(mockQuotationId, {
          productId: 'invalid-product',
          quantity: 1,
          items: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProductInQuotation', () => {
    it('should update product quantity', async () => {
      prisma.quotationProduct.findUnique.mockResolvedValue({
        ...mockQuotationProduct,
        quotation: mockQuotation,
        product: mockProduct,
        items: mockQuotationProduct.items,
      });
      prisma.quotationProduct.update.mockResolvedValue({
        ...mockQuotationProduct,
        quantity: 2,
      });
      prisma.quotationProductItem.findMany.mockResolvedValue(
        mockQuotationProduct.items,
      );
      prisma.quotationProductItem.updateMany.mockResolvedValue({ count: 2 });
      prisma.quotationProduct.findMany.mockResolvedValue([
        mockQuotationProduct,
      ]);
      prisma.quotation.update.mockResolvedValue(mockQuotation);

      const result = await service.updateProductInQuotation(
        mockQuotationProductId,
        { quantity: 2 },
      );

      expect(result).toBeDefined();
    });

    it('should throw BadRequestException if product not found', async () => {
      prisma.quotationProduct.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProductInQuotation('invalid-id', { quantity: 2 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeProductFromQuotation', () => {
    it('should remove product and recalculate total', async () => {
      prisma.quotationProduct.findUnique.mockResolvedValue({
        ...mockQuotationProduct,
        items: mockQuotationProduct.items,
      });
      prisma.quotationProductItem.deleteMany.mockResolvedValue({ count: 2 });
      prisma.quotationProduct.delete.mockResolvedValue(mockQuotationProduct);
      prisma.quotation.update.mockResolvedValue(mockQuotation);
      prisma.quotationProduct.findMany.mockResolvedValue([]);
      prisma.quotationPayment.update.mockResolvedValue({});

      const result = await service.removeProductFromQuotation(
        mockQuotationProductId,
      );

      expect(result).toBeDefined();
      expect(prisma.quotationProduct.delete).toHaveBeenCalled();
    });

    it('should throw BadRequestException if product not found', async () => {
      prisma.quotationProduct.findUnique.mockResolvedValue(null);

      await expect(
        service.removeProductFromQuotation('invalid-id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('duplicateProductInQuotation', () => {
    it('should duplicate product with items', async () => {
      prisma.quotationProduct.findFirst.mockResolvedValue({
        ...mockQuotationProduct,
        items: mockQuotationProduct.items,
      });
      prisma.quotationProduct.create.mockResolvedValue({
        ...mockQuotationProduct,
        id: 'new-quotation-product-id',
      });
      prisma.quotationProductItem.createMany.mockResolvedValue({ count: 2 });
      prisma.quotationProduct.findMany.mockResolvedValue([
        mockQuotationProduct,
      ]);
      prisma.quotation.update.mockResolvedValue(mockQuotation);
      prisma.quotationPayment.update.mockResolvedValue({});
      prisma.quotation.findUnique.mockResolvedValue({
        ...mockQuotation,
        quotationProduct: [mockQuotationProduct],
      });

      const result = await service.duplicateProductInQuotation(
        mockQuotationProductId,
      );

      expect(result).toBeDefined();
      expect(prisma.quotationProduct.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if product not found', async () => {
      prisma.quotationProduct.findFirst.mockResolvedValue(null);

      await expect(
        service.duplicateProductInQuotation('invalid-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('recalculateQuotationTotalValue', () => {
    it('should recalculate total value correctly', async () => {
      prisma.quotationProduct.findMany.mockResolvedValue([
        { finalValue: 5000 },
        { finalValue: 3000 },
      ]);
      prisma.quotation.update.mockResolvedValue({
        ...mockQuotation,
        totalValue: 8000,
      });
      prisma.quotationPayment.update.mockResolvedValue({});

      await service.recalculateQuotationTotalValue(mockQuotationId);

      expect(prisma.quotation.update).toHaveBeenCalled();
    });
  });
});
