import { reservedByKey } from './stock-consumption';
import { StockService } from './stock.service';

/** A reserva do FULL (item 23; Maicol, 23/11/2026). */
describe('a reserva das vendas aprovadas em andamento', () => {
  const item = (materialId: string, quantity: number) => ({
    origin: 'MATERIAL',
    quantity,
    materialId,
    materialVariationId: null,
    snapshot: null,
    lines: [],
  });

  it('soma o material das vendas sem a baixa da venda, menos o que saiu no rolo', async () => {
    const prisma = {
      quotation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'q1', quotationProduct: [item('lona', 10), item('ilhos', 40)] },
          { id: 'q2', quotationProduct: [item('lona', 5)] },
          { id: 'q3', quotationProduct: [item('lona', 99)] },
        ]),
      },
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([
          // q2: o impressor baixou a lona no rolo
          {
            quotationId: 'q2',
            lotId: 'l1',
            kind: 'CONSUMPTION',
            replacesKey: 'lona|',
          },
          // q3: a venda já teve a baixa
          {
            quotationId: 'q3',
            lotId: null,
            kind: 'CONSUMPTION',
            replacesKey: null,
          },
        ]),
      },
    };
    const reserved = await reservedByKey(prisma as never, 'c1');
    expect(Object.fromEntries(reserved)).toEqual({ 'lona|': 10, 'ilhos|': 40 });
    expect(prisma.quotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId: 'c1',
          status: 'APPROVED',
          order: {
            is: { status: { in: ['PENDING', 'IN_PRODUCTION', 'DELIVERY'] } },
          },
        },
      }),
    );
  });
});

describe('o saldo do estoque com a reserva', () => {
  const setup = (full: boolean) => {
    const prisma = {
      stockItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's1',
            key: 'lona|',
            materialId: 'lona',
            variationId: null,
            quantity: 30,
            minimum: 0,
            averageCost: 100,
            lastEntryCost: 100,
            lastEntryDate: null,
            material: { name: 'Lona', unit: 'M2' },
            variation: null,
          },
        ]),
      },
      quotation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'q1',
            quotationProduct: [
              {
                origin: 'MATERIAL',
                quantity: 10,
                materialId: 'lona',
                materialVariationId: null,
                snapshot: null,
                lines: [],
              },
            ],
          },
        ]),
      },
      stockMovement: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const plans = { hasFeature: jest.fn().mockResolvedValue(full) };
    const service = new StockService(
      prisma as never,
      {} as never,
      plans as never,
    );
    return { service, prisma, plans };
  };

  it('no FULL (compras e lotes): o reservado e o disponível', async () => {
    const { service, plans } = setup(true);
    const { data } = await service.list('c1', {}, false);
    expect(plans.hasFeature).toHaveBeenCalledWith('c1', 'purchasing');
    expect(data[0]).toMatchObject({
      quantity: 30,
      reserved: 10,
      available: 20,
    });
  });

  it('sem a chave: não lê as vendas abertas e devolve só o saldo', async () => {
    const { service, prisma } = setup(false);
    const { data } = await service.list('c1', {}, false);
    expect(prisma.quotation.findMany).not.toHaveBeenCalled();
    expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
    expect(data[0].quantity).toBe(30);
    expect(data[0]).not.toHaveProperty('reserved');
    expect(data[0]).not.toHaveProperty('available');
  });
});
