import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  APPROVED_WITH_STOCK,
  QuotationLinesService,
} from './quotation-lines.service';

/**
 * As linhas dentro do item (ORC-5): preço de cada tipo, a medida que a linha
 * usa, o dinheiro só para quem vê valores (ORC-7) e o valor do item com as
 * linhas por fora do desconto.
 */
describe('QuotationLinesService', () => {
  const quotationId = 'q-1';
  const itemId = 'i-1';

  const itemRow = (status = 'OPEN') => ({
    id: itemId,
    quantity: 2,
    items: [{ width: 900, height: 1200 }],
    quotation: { status, companyId: 'c-1', subCompanyId: null },
  });

  let prisma: any;
  let processes: { lineQuote: jest.Mock };
  let productSale: { itemComposition: jest.Mock; saleForm: jest.Mock };
  let settings: { outsourcedMarkupOf: jest.Mock };
  let plan: { hasFeature: jest.Mock };
  let service: QuotationLinesService;

  beforeEach(() => {
    prisma = {
      quotationProduct: {
        findFirst: jest.fn().mockResolvedValue(itemRow()),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: itemId,
          quotationId,
          totalValue: 10000,
          discount: 1000,
          discountType: 'VALUE',
          addition: 500,
        }),
        findMany: jest.fn().mockResolvedValue([{ finalValue: 14500 }]),
        update: jest.fn(),
      },
      quotationItemLine: {
        create: jest.fn(({ data }) => ({ id: 'l-1', ...data })),
        aggregate: jest.fn().mockResolvedValue({ _sum: { price: 5000 } }),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
      quotation: { update: jest.fn() },
      quotationPayment: { update: jest.fn() },
      process: {
        findFirst: jest.fn().mockResolvedValue({ afterBase: 'INHERIT' }),
      },
      product: { findFirst: jest.fn() },
      supplier: { findFirst: jest.fn() },
    };
    processes = {
      lineQuote: jest.fn().mockResolvedValue({
        name: 'Laminação',
        sector: 'Acabamento',
        followsBaseDefault: true,
        instructions: [],
        price: 2160,
        cost: 1080,
        resolved: [{ resource: 'Filme', cost: 1080 }],
      }),
    };
    productSale = {
      itemComposition: jest.fn(),
      saleForm: jest.fn().mockResolvedValue(null),
    };
    settings = { outsourcedMarkupOf: jest.fn().mockResolvedValue(45) };
    plan = { hasFeature: jest.fn().mockResolvedValue(false) };
    service = new QuotationLinesService(
      prisma,
      processes as any,
      productSale as any,
      settings as any,
      plan as any,
      { syncItem: jest.fn().mockResolvedValue(undefined) } as any,
    );
  });

  it('o processo que acompanha a base usa a medida do item', async () => {
    const preview = await service.preview(
      quotationId,
      itemId,
      { kind: 'PROCESS', processId: 'p-1' } as any,
      true,
    );
    expect(processes.lineQuote).toHaveBeenCalledWith(
      'c-1',
      'p-1',
      { quantity: 2, width: 900, height: 1200 },
      [],
      true,
    );
    expect(preview).toMatchObject({
      price: 2160,
      tags: ['2 un', '0,9 × 1,2 m'],
      followsBaseDefault: true,
    });
  });

  it('sem a permissão de valores, a prévia sai sem dinheiro (ORC-7)', async () => {
    const preview = await service.preview(
      quotationId,
      itemId,
      { kind: 'LOOSE', description: 'Letra caixa', cost: 20000 } as any,
      false,
    );
    expect(preview).toEqual({
      tags: ['terceirizado'],
      followsBaseDefault: null,
      instructions: [],
    });
  });

  it('medida própria sem largura e altura é recusada', async () => {
    await expect(
      service.preview(
        quotationId,
        itemId,
        { kind: 'PROCESS', processId: 'p-1', followsBase: false } as any,
        true,
      ),
    ).rejects.toThrow(new BadRequestException('Informe a medida da linha'));
  });

  it('a parte por área cobra o preço do m² na medida', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'pr-1',
      name: 'Placa PS',
      companyId: 'c-1',
      isActive: true,
      sector: { name: 'Corte' },
      items: [{ unitKind: 'AREA', unitCost: 0.0045 }],
      assemblies: [],
    });
    const preview = await service.preview(
      quotationId,
      itemId,
      {
        kind: 'PART',
        productId: 'pr-1',
        followsBase: false,
        measure: { quantity: 1, width: 2000, height: 1000 },
      } as any,
      true,
    );
    expect(preview.price).toBe(9000);
  });

  it('o terceirizado de quem não vê valores grava o preço sugerido', async () => {
    const res = await service.add(
      quotationId,
      itemId,
      {
        kind: 'LOOSE',
        description: 'Letra caixa',
        supplier: 'Letras & Cia',
        cost: 20000,
        price: 99999,
      } as any,
      false,
    );
    expect(prisma.quotationItemLine.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          price: 36364,
          cost: 20000,
          sector: 'Terceirizado · Letras & Cia',
        }),
      }),
    );
    expect(res.line).not.toHaveProperty('price');
    expect(res.item).toEqual({ id: itemId });
  });

  it('o valor do item soma as linhas por fora do desconto', async () => {
    const res = await service.add(
      quotationId,
      itemId,
      { kind: 'PROCESS', processId: 'p-1' } as any,
      true,
    );
    // 100,00 − 10,00 de desconto + 5,00 de acréscimo + 50,00 das linhas
    expect(prisma.quotationProduct.update).toHaveBeenCalledWith({
      where: { id: itemId },
      data: { linesTotal: 5000, finalValue: 14500 },
    });
    expect(res.item).toEqual({ id: itemId, linesTotal: 5000, total: 14500 });
    expect(prisma.quotation.update).toHaveBeenCalledWith({
      where: { id: quotationId },
      data: { totalValue: 14500 },
    });
  });

  it('só com o orçamento em digitação, e só linha do próprio item', async () => {
    prisma.quotationProduct.findFirst.mockResolvedValueOnce(itemRow('CLOSED'));
    await expect(
      service.add(
        quotationId,
        itemId,
        { kind: 'LOOSE', description: 'X', cost: 100 } as any,
        true,
      ),
    ).rejects.toThrow('Só dá para mexer no item com o orçamento em digitação');

    // O.S. aprovada numa conta com estoque: a composição fica como foi vendida
    plan.hasFeature.mockResolvedValueOnce(true);
    prisma.quotationProduct.findFirst.mockResolvedValueOnce(
      itemRow('APPROVED'),
    );
    await expect(
      service.add(
        quotationId,
        itemId,
        { kind: 'LOOSE', description: 'X', cost: 100 } as any,
        true,
      ),
    ).rejects.toThrow(APPROVED_WITH_STOCK);
    expect(plan.hasFeature).toHaveBeenCalledWith('c-1', 'stock_control');

    prisma.quotationItemLine.findFirst.mockResolvedValue(null);
    await expect(
      service.remove(quotationId, itemId, 'l-de-outro-item', true),
    ).rejects.toThrow(new NotFoundException('Linha não encontrada'));
    expect(prisma.quotationItemLine.delete).not.toHaveBeenCalled();
  });
});
