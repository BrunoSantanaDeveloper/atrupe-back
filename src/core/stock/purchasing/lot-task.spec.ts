import { consumeSale } from '../stock-consumption';
import { soldMaterials } from './lot-task';

describe('baixa do impressor no rolo (ES-16)', () => {
  it('os materiais vendidos da etapa, pelo resourceId', () => {
    expect(
      soldMaterials([
        { kind: 'MACHINE', resource: 'Plotter', resourceId: 'machine:x' },
        {
          kind: 'MATERIAL',
          resource: 'Adesivo branco',
          resourceId: 'material:m1:v1',
          quantity: 2,
          unit: 'm²',
        },
        {
          kind: 'MATERIAL',
          resource: 'Adesivo branco',
          resourceId: 'material:m1:v1',
          quantity: 1.5,
          unit: 'm²',
        },
        { kind: 'MATERIAL', resource: 'Antigo, sem id', quantity: 1 },
      ]),
    ).toEqual([
      {
        key: 'm1|v1',
        materialId: 'm1',
        variationId: 'v1',
        name: 'Adesivo branco',
        quantity: 3.5,
        unit: 'm²',
      },
    ]);
  });

  it('a baixa da venda não tira de novo o que o rolo substituiu', async () => {
    const tx = {
      stockItem: {
        upsert: jest.fn().mockResolvedValue({ id: 's', averageCost: 10 }),
      },
      stockMovement: { create: jest.fn() },
    };
    const prisma: any = {
      quotation: {
        findUnique: jest.fn().mockResolvedValue({
          companyId: 'c1',
          quotationNumber: 12,
          description: 'Placa',
          series: null,
          quotationProduct: [
            {
              origin: 'CATALOG',
              quantity: 1,
              snapshot: {
                data: {
                  stages: [
                    {
                      lines: [
                        { resourceId: 'material:adesivo', quantity: 3 },
                        { resourceId: 'material:ilhos', quantity: 8 },
                      ],
                    },
                  ],
                },
              },
              lines: [],
            },
          ],
        }),
      },
      stockItem: { count: jest.fn().mockResolvedValue(5) },
      stockMovement: {
        // A baixa do rolo não conta como a baixa da venda
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([{ replacesKey: 'adesivo|' }]),
      },
      material: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'adesivo' }, { id: 'ilhos' }]),
      },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };
    const result = await consumeSale(prisma, 'q1', 'Sistema');
    expect(result.consumed).toBe(1);
    expect(tx.stockItem.upsert).toHaveBeenCalledTimes(1);
    expect(tx.stockItem.upsert.mock.calls[0][0].where.companyId_key.key).toBe(
      'ilhos|',
    );
    expect(prisma.stockMovement.count).toHaveBeenCalledWith({
      where: {
        companyId: 'c1',
        quotationId: 'q1',
        kind: 'CONSUMPTION',
        lotId: null,
      },
    });
  });
});
