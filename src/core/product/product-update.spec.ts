import { ProductService } from './product.service';

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
