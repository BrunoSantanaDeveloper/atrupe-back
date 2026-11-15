import { ProductService } from './product.service';

/**
 * PATCH parcial do produto. O "Salvar no produto" da nota mandava só os itens
 * e zerava as etapas de produção; um corpo sem `items` contava como "nenhum
 * item enviado" e apagava todos, junto com as composições das O.S.
 */
describe('ProductService.update', () => {
  const prisma = {
    product: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    productItem: { deleteMany: jest.fn() },
    quotationProductItem: { deleteMany: jest.fn() },
  };
  const service = new ProductService(prisma as any, {} as any);
  const dadosGravados = () => prisma.product.update.mock.calls[0][0].data;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    prisma.product.findUnique.mockResolvedValue({
      id: 'produto-1',
      code: 'PS2',
      companyId: 'empresa-1',
      items: [{ id: 'item-1' }, { id: 'item-2' }],
    });
    prisma.product.update.mockResolvedValue({ id: 'produto-1' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('corpo sem itens não apaga itens nem composições das O.S.', async () => {
    await service.update('produto-1', { name: 'Placa PS2mm' });

    expect(prisma.quotationProductItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.productItem.deleteMany).not.toHaveBeenCalled();
    expect(dadosGravados()).not.toHaveProperty('items');
  });

  it('corpo sem etapas mantém as etapas de produção', async () => {
    await service.update('produto-1', { name: 'Placa PS2mm' });

    expect(dadosGravados()).not.toHaveProperty('productionStages');
  });

  it('etapas enviadas, mesmo vazias, substituem as gravadas', async () => {
    await service.update('produto-1', { productionStages: [] });

    expect(dadosGravados().productionStages).toEqual([]);
  });

  it('com itens no corpo, remove só os que ficaram de fora', async () => {
    await service.update('produto-1', {
      items: [{ id: 'item-1', name: 'Placa', unitKind: 'AREA' }],
    } as any);

    expect(prisma.productItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['item-2'] } },
    });
    expect(dadosGravados().items.upsert).toHaveLength(1);
  });
});
