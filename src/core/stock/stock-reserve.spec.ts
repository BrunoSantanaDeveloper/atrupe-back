import { reservedByKey } from './stock-consumption';

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
