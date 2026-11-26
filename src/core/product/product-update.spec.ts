import { ProductService, soldItemsWhere } from './product.service';

/**
 * O PATCH /product/:id parcial (o descritivo, as permissões de edição, que a
 * composição grava) não pode apagar os itens nem as etapas de produção. Antes,
 * o PATCH sem `items` removia todos os itens e as referências deles nos itens
 * de orçamento, e o sem `productionStages` zerava as etapas.
 */
describe('ProductService.update parcial', () => {
  let prisma: any;
  let service: ProductService;

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pr-1',
          companyId: 'c-1',
          code: 'BAN',
          items: [{ id: 'i-1' }, { id: 'i-2' }],
        }),
        update: jest.fn().mockResolvedValue({ id: 'pr-1' }),
      },
      productItem: { deleteMany: jest.fn() },
      quotationProductItem: { deleteMany: jest.fn() },
      category: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      companySector: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      supplier: { count: jest.fn().mockResolvedValue(1) },
    };
    service = new ProductService(prisma, {} as any);
  });

  it('sem items no corpo, nenhum item sai', async () => {
    await service.update('pr-1', { technicalDescription: 'Lona 440 g' } as any);

    expect(prisma.productItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.quotationProductItem.deleteMany).not.toHaveBeenCalled();
    const data = prisma.product.update.mock.calls[0][0].data;
    expect(data.technicalDescription).toBe('Lona 440 g');
    // Sem etapas no corpo, elas ficam como estão
    expect(data).not.toHaveProperty('productionStages');
  });

  it('com items, sai o que ficou de fora da lista', async () => {
    await service.update('pr-1', {
      items: [{ id: 'i-1', unitCost: 0.0045 }],
      productionStages: [],
    } as any);

    expect(prisma.productItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['i-2'] } },
    });
    expect(
      prisma.product.update.mock.calls[0][0].data.productionStages,
    ).toEqual([]);
  });

  // O terceirizado gravava só junto do allowEditValues (pacote de 26/10)
  it('liga o terceirizado sem mandar as liberações de edição', async () => {
    await service.update('pr-1', {
      isOutsourced: true,
      outsourcedCost: 0.02,
      supplierIds: ['s-1'],
    } as any);

    const data = prisma.product.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      isOutsourced: true,
      outsourcedCost: 0.02,
      suppliers: { set: [{ id: 's-1' }] },
    });
    expect(data).not.toHaveProperty('allowEditValues');
  });
});

// A estrutura do produto (18/11/2026): o terceirizado é o espelho dela
describe('ProductService.update: a estrutura do produto', () => {
  let prisma: any;
  let service: ProductService;
  const stored = (over: Record<string, unknown> = {}) => ({
    id: 'pr-1',
    companyId: 'c-1',
    code: 'BAN',
    items: [],
    structure: 'STANDARD',
    isOutsourced: false,
    outsourcedCost: null,
    _count: { suppliers: 0 },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue(stored()),
        update: jest.fn().mockResolvedValue({ id: 'pr-1' }),
      },
      productItem: { deleteMany: jest.fn() },
      quotationProductItem: { deleteMany: jest.fn() },
      category: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      companySector: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      supplier: { count: jest.fn().mockResolvedValue(1) },
      quotationProduct: { count: jest.fn().mockResolvedValue(0) },
    };
    service = new ProductService(prisma, {} as any);
  });
  const data = () => prisma.product.update.mock.calls[0][0].data;

  it('sair do terceirizado guarda o fornecedor e o custo', async () => {
    prisma.product.findUnique.mockResolvedValue(
      stored({
        structure: 'OUTSOURCED',
        isOutsourced: true,
        outsourcedCost: 0.02,
        _count: { suppliers: 1 },
      }),
    );
    await service.update('pr-1', { structure: 'SHEET' } as any);
    expect(data()).toMatchObject({ structure: 'SHEET', isOutsourced: false });
    expect(data()).not.toHaveProperty('suppliers');
    expect(data()).not.toHaveProperty('outsourcedCost');
  });

  it('voltar ao terceirizado reaproveita o que ficou guardado', async () => {
    prisma.product.findUnique.mockResolvedValue(
      stored({
        structure: 'SHEET',
        outsourcedCost: 0.02,
        _count: { suppliers: 1 },
      }),
    );
    await service.update('pr-1', { structure: 'OUTSOURCED' } as any);
    expect(data()).toMatchObject({
      structure: 'OUTSOURCED',
      isOutsourced: true,
    });
  });

  it('terceirizado sem fornecedor guardado nem enviado é recusado', async () => {
    await expect(
      service.update('pr-1', { structure: 'OUTSOURCED' } as any),
    ).rejects.toThrow('Informe o fornecedor e o custo do terceirizado');
  });

  it('estrutura e terceirizado em conflito são recusados', async () => {
    await expect(
      service.update('pr-1', { structure: 'SHEET', isOutsourced: true } as any),
    ).rejects.toThrow('não combinam');
  });

  it('o corpo antigo só com isOutsourced leva a estrutura junto', async () => {
    await service.update('pr-1', {
      isOutsourced: true,
      outsourcedCost: 0.02,
      supplierIds: ['s-1'],
    } as any);
    expect(data()).toMatchObject({
      structure: 'OUTSOURCED',
      isOutsourced: true,
    });
  });

  it('desligar o terceirizado pelo corpo antigo mantém a estrutura de folha', async () => {
    prisma.product.findUnique.mockResolvedValue(stored({ structure: 'SHEET' }));
    await service.update('pr-1', { isOutsourced: false } as any);
    expect(data()).toMatchObject({ structure: 'SHEET', isOutsourced: false });
  });

  // O tipo trava depois de usado em orçamento (25/11/2026)
  it('produto já usado em orçamento não troca de tipo', async () => {
    prisma.quotationProduct.count.mockResolvedValue(3);
    await expect(
      service.update('pr-1', { structure: 'SHEET' } as any),
    ).rejects.toThrow('já foi usado em orçamento');
    expect(prisma.product.update).not.toHaveBeenCalled();
    // Pela empresa do produto, como o "onde é usado" da tela
    expect(prisma.quotationProduct.count).toHaveBeenCalledWith({
      where: soldItemsWhere('c-1', 'pr-1'),
    });
    expect(soldItemsWhere('c-1', 'pr-1')).toEqual({
      productId: 'pr-1',
      quotation: { companyId: 'c-1' },
    });
  });

  it('produto usado pode ser editado sem trocar o tipo', async () => {
    prisma.quotationProduct.count.mockResolvedValue(3);
    await service.update('pr-1', {
      structure: 'STANDARD',
      technicalDescription: 'Lona 440 g',
    } as any);
    expect(data()).toMatchObject({ technicalDescription: 'Lona 440 g' });
  });

  it('produto nunca usado troca de tipo', async () => {
    await service.update('pr-1', { structure: 'SHEET' } as any);
    expect(data()).toMatchObject({ structure: 'SHEET' });
  });
});
