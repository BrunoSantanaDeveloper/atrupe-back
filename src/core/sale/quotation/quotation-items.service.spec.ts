import { Test, TestingModule } from '@nestjs/testing';
import { QuotationItemsService } from './quotation-items.service';
import { PrismaService } from 'nestjs-prisma';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QuotationStatus } from '@prisma/client';
import { ProductSaleService } from '../../assembly/product-sale.service';
import { QuotationLinesService } from './quotation-lines.service';
import { itemValue } from './quotation-totals';

const mockQuotationId = 'quotation-uuid-456';
const mockProductId = 'product-uuid-123';
const mockQuotationProductId = 'quotation-product-uuid-789';

const mockProduct = {
  id: mockProductId,
  name: 'Test Product',
  isActive: true,
  companyId: 'company-uuid-1',
  price: 10000,
  productItem: [
    { id: 'item-1', price: 5000, value: 5000 },
    { id: 'item-2', price: 5000, value: 5000 },
  ],
};

const mockQuotation = {
  id: mockQuotationId,
  companyId: 'company-uuid-1',
  subCompanyId: 'company-uuid-1',
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
    findFirst: jest.fn(),
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
  productVariation: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  productAssembly: {
    findFirst: jest.fn().mockResolvedValue(null),
  },
  quotationItemLine: {
    findMany: jest.fn().mockResolvedValue([]),
    createMany: jest.fn(),
  },
});

describe('QuotationItemsService', () => {
  let service: QuotationItemsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let productSale: { itemComposition: jest.Mock };
  let lines: {
    recalculate: jest.Mock;
    refreshItem: jest.Mock;
    approvedEditable: jest.Mock;
    afterItemChange: jest.Mock;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    lines = {
      recalculate: jest.fn().mockResolvedValue(0),
      refreshItem: jest.fn().mockResolvedValue({}),
      afterItemChange: jest.fn().mockResolvedValue(undefined),
      // Com estoque: a O.S. aprovada fica como foi vendida
      approvedEditable: jest.fn().mockResolvedValue(false),
    };
    productSale = {
      itemComposition: jest.fn().mockResolvedValue({
        composition: { choices: [], summary: ['Lona 440'] },
        snapshot: { cost: 1500, stages: [] },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotationItemsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        { provide: ProductSaleService, useValue: productSale },
        { provide: QuotationLinesService, useValue: lines },
      ],
    }).compile();

    service = module.get<QuotationItemsService>(QuotationItemsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('item com variação, composição e acréscimo (Fase 4.1)', () => {
    const add = (extra: Record<string, unknown> = {}) =>
      service.addProductToQuotation(mockQuotationId, {
        productId: mockProductId,
        quantity: 2,
        items: [{ id: 'item-1', salePrice: 5000, width: 900, height: 1200 }],
        ...extra,
      } as any);

    beforeEach(() => {
      prisma.quotation.findUnique.mockResolvedValue(mockQuotation);
      prisma.product.findFirst.mockResolvedValue({
        ...mockProduct,
        items: mockProduct.productItem,
      });
      prisma.quotationProduct.create.mockResolvedValue(mockQuotationProduct);
      prisma.quotationProduct.findMany.mockResolvedValue([]);
    });

    it('produto inativo não entra (PAD-7)', async () => {
      prisma.product.findFirst.mockResolvedValue({
        ...mockProduct,
        isActive: false,
        items: [],
      });
      await expect(add()).rejects.toThrow(
        'Produto inativo não entra no orçamento',
      );
    });

    it('o produto de vários itens entra sem variação (LITE part3, item 5)', async () => {
      // O produto padrão do teste tem dois itens
      prisma.productVariation.findMany.mockResolvedValue([{ id: 'v-1' }]);
      await add();
      expect(prisma.quotationProduct.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ variationId: null }),
      });
    });

    it('o produto de um item com variações exige uma, e ela é dele (PV-6)', async () => {
      prisma.product.findFirst.mockResolvedValue({
        ...mockProduct,
        items: [mockProduct.productItem[0]],
      });
      prisma.productVariation.findMany.mockResolvedValue([{ id: 'v-1' }]);
      await expect(add()).rejects.toThrow('Escolha a variação do produto');
      await expect(add({ variationId: 'v-9' })).rejects.toThrow(
        new NotFoundException('Variação não encontrada'),
      );
      await add({ variationId: 'v-1' });
      expect(prisma.quotationProduct.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ variationId: 'v-1' }),
      });
    });

    it('a composição escolhida e o retrato vão no item (ORC-10)', async () => {
      const composition = {
        choices: [{ blockId: 'b', lineId: 'l', optionId: 'o' }],
      };
      await add({ composition });
      expect(productSale.itemComposition).toHaveBeenCalledWith(
        'company-uuid-1',
        mockProductId,
        null,
        { quantity: 2, width: 900, height: 1200 },
        composition,
      );
      expect(prisma.quotationProduct.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          composition: { choices: [], summary: ['Lona 440'] },
          // O retrato vai para a tabela própria (ORC-7)
          snapshot: { create: { data: { cost: 1500, stages: [] } } },
        }),
      });
    });

    it('sem escolhas, o produto com composição liberada ganha o retrato padrão', async () => {
      prisma.productAssembly.findFirst.mockResolvedValue({ id: 'a-1' });
      await add();
      expect(productSale.itemComposition.mock.calls[0][4]).toEqual({});

      productSale.itemComposition.mockClear();
      prisma.productAssembly.findFirst.mockResolvedValue(null);
      await add();
      expect(productSale.itemComposition).not.toHaveBeenCalled();
    });

    it('o acréscimo soma por fora do desconto (ALT-25)', async () => {
      prisma.quotationProduct.findUnique
        .mockResolvedValueOnce({
          ...mockQuotationProduct,
          addition: 0,
          composition: null,
          snapshot: null,
          variationId: null,
          product: { ...mockProduct },
        })
        .mockResolvedValue({
          ...mockQuotationProduct,
          totalValue: 10000,
          discount: 1000,
          discountType: 'VALUE',
          addition: 2500,
        });
      prisma.quotationProduct.update.mockResolvedValue(mockQuotationProduct);

      await service.updateProductInQuotation(mockQuotationProductId, {
        addition: 2500,
      } as any);

      // O valor do item é refeito com o acréscimo e as linhas
      expect(lines.refreshItem).toHaveBeenCalledWith(mockQuotationProductId);
      expect(itemValue(10000, 1000, 'VALUE', 2500)).toBe(11500);
    });

    it('as linhas somam por fora do desconto, e o valor nunca fica negativo (ORC-5)', () => {
      expect(itemValue(10000, 10, 'PERCENT', 0, 5000)).toBe(14000);
      expect(itemValue(10000, 1000, 'VALUE', 2500, 3000)).toBe(14500);
      expect(itemValue(1000, 5000, 'VALUE', 0, 0)).toBe(0);
    });

    it('medida nova refaz as linhas que acompanham a base e o valor do item', async () => {
      prisma.quotationProduct.findUnique.mockResolvedValue({
        ...mockQuotationProduct,
        addition: 0,
        linesTotal: 0,
        composition: null,
        snapshot: null,
        variationId: null,
        product: { ...mockProduct },
      });
      prisma.quotationProduct.update.mockResolvedValue(mockQuotationProduct);
      prisma.quotationProductItem.findMany.mockResolvedValue([]);
      lines.recalculate.mockResolvedValue(2);

      const result = await service.updateProductInQuotation(
        mockQuotationProductId,
        { quantity: 3 } as any,
      );

      expect(lines.recalculate).toHaveBeenCalledWith(mockQuotationProductId);
      expect(lines.refreshItem).toHaveBeenCalledWith(mockQuotationProductId);
      expect(result).toMatchObject({ linesRecalculated: 2 });
    });

    it('venda aprovada com estoque: a edição não refaz o retrato nem as linhas (ORC-10)', async () => {
      prisma.quotationProduct.findUnique.mockResolvedValue({
        ...mockQuotationProduct,
        quotation: { ...mockQuotation, status: 'APPROVED' },
        addition: 0,
        linesTotal: 0,
        composition: { choices: [] },
        snapshot: { quotationProductId: mockQuotationProductId },
        variationId: null,
        product: { ...mockProduct },
      });
      prisma.quotationProduct.update.mockResolvedValue(mockQuotationProduct);
      prisma.quotationProductItem.findMany.mockResolvedValue([]);

      await service.updateProductInQuotation(mockQuotationProductId, {
        quantity: 3,
        composition: { choices: [] },
        variationId: 'v-1',
      } as any);

      expect(productSale.itemComposition).not.toHaveBeenCalled();
      expect(lines.recalculate).not.toHaveBeenCalled();
      expect(prisma.productVariation.findMany).not.toHaveBeenCalled();
      expect(
        prisma.quotationProduct.update.mock.calls[0][0].data,
      ).not.toHaveProperty('variationId');
      expect(lines.approvedEditable).toHaveBeenCalledWith(
        mockQuotation.companyId,
      );
    });

    it('venda aprovada sem estoque: muda a composição e refaz o retrato (PO, 14/10)', async () => {
      lines.approvedEditable.mockResolvedValue(true);
      prisma.quotationProduct.findUnique.mockResolvedValue({
        ...mockQuotationProduct,
        quotation: { ...mockQuotation, status: 'APPROVED' },
        addition: 0,
        linesTotal: 0,
        composition: { choices: [] },
        snapshot: { quotationProductId: mockQuotationProductId },
        variationId: null,
        product: { ...mockProduct },
      });
      prisma.quotationProduct.update.mockResolvedValue(mockQuotationProduct);
      prisma.quotationProductItem.findMany.mockResolvedValue([]);

      await service.updateProductInQuotation(mockQuotationProductId, {
        quantity: 3,
        composition: { choices: [] },
      } as any);

      expect(productSale.itemComposition).toHaveBeenCalled();
      expect(lines.recalculate).toHaveBeenCalledWith(mockQuotationProductId);
      expect(
        prisma.quotationProduct.update.mock.calls[0][0].data,
      ).toHaveProperty('snapshot');
    });
  });

  describe('addProductToQuotation', () => {
    it('should add product to quotation', async () => {
      prisma.quotation.findUnique.mockResolvedValue(mockQuotation);
      prisma.product.findFirst.mockResolvedValue({
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

    it('produto de outra empresa: 404, sem entrar no orçamento', async () => {
      prisma.quotation.findUnique.mockResolvedValue(mockQuotation);
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.addProductToQuotation(mockQuotationId, {
          productId: 'produto-de-outra-empresa',
          quantity: 1,
          items: [],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'produto-de-outra-empresa',
          companyId: { in: ['company-uuid-1', 'company-uuid-1'] },
        },
        include: { items: true },
      });
      expect(prisma.quotationProduct.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if product not found', async () => {
      prisma.quotation.findUnique.mockResolvedValue(mockQuotation);
      prisma.product.findFirst.mockResolvedValue(null);

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
    it('item de outro produto (de outro orçamento): 404, sem alterar nada', async () => {
      prisma.quotationProduct.findUnique.mockResolvedValue({
        ...mockQuotationProduct,
        quotation: mockQuotation,
        product: mockProduct,
        items: mockQuotationProduct.items,
      });

      await expect(
        service.updateProductInQuotation(mockQuotationProductId, {
          items: [{ id: 'item-de-outro-orcamento', quantity: 9 }],
        } as any),
        // O erro de validação chega à tela com a mensagem dele (antes, todo
        // erro virava "Falha ao atualizar produto no orçamento")
      ).rejects.toThrow(NotFoundException);
      expect(prisma.quotationProduct.update).not.toHaveBeenCalled();
      expect(prisma.quotationProductItem.update).not.toHaveBeenCalled();
    });

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

    it('produto do orçamento inexistente: 404 com a mensagem', async () => {
      prisma.quotationProduct.findUnique.mockResolvedValue(null);

      await expect(
        service.updateProductInQuotation('invalid-id', { quantity: 2 }),
      ).rejects.toThrow(new NotFoundException('Produto não encontrado'));
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
