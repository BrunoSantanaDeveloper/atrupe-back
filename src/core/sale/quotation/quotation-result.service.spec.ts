import { NotFoundException } from '@nestjs/common';
import { QuotationResultService } from './quotation-result.service';

/**
 * O resultado previsto (ORC-8): o custo sai do retrato gravado (ORC-10) e das
 * linhas, sem refazer a conta; comissão pelo perfil do vendedor e tributos
 * pela Precificação.
 */
describe('QuotationResultService', () => {
  const computedAt = new Date('2026-10-12T12:00:00Z');
  let prisma: any;
  let pricing: { chargesOf: jest.Mock };
  let service: QuotationResultService;

  beforeEach(() => {
    prisma = {
      quotation: {
        findUnique: jest.fn().mockResolvedValue({
          companyId: 'c-1',
          totalValue: 100000,
          seller: { sellerProfile: { commission: 5 } },
          quotationPayment: { finalValue: 100000 },
          quotationProduct: [
            {
              id: 'item-1',
              description: 'Lona com ilhós',
              finalValue: 80000,
              product: { name: 'Lona' },
              snapshot: {
                computedAt,
                data: {
                  cost: 30000,
                  stages: [
                    {
                      blockId: 'b-1',
                      name: 'Impressão',
                      sector: 'Impressão',
                      cost: 30000,
                      lines: [
                        {
                          kind: 'MATERIAL',
                          resource: 'Lona 440',
                          unit: 'm²',
                          quantity: 3,
                          unitCost: 1250,
                          cost: 3750,
                        },
                        {
                          kind: 'MATERIAL',
                          name: 'Fixação',
                          entries: [
                            {
                              name: 'Ilhós',
                              unit: 'un',
                              quantity: 16,
                              unitCost: 10,
                              cost: 160,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
              lines: [
                {
                  id: 'ln-1',
                  kind: 'LOOSE',
                  name: 'Letra caixa',
                  sector: 'Terceirizado',
                  price: 20000,
                  cost: 12000,
                  resolved: null,
                  resolvedAt: computedAt,
                },
              ],
            },
            {
              id: 'item-2',
              description: 'Cartão',
              finalValue: 20000,
              product: { name: 'Cartão' },
              snapshot: null,
              lines: [],
            },
          ],
        }),
      },
    };
    // Tributação em décimos de ponto: 100 = 10 %
    pricing = {
      chargesOf: jest
        .fn()
        .mockResolvedValue({ taxation: 100, financialCost: 0, commission: 0 }),
    };
    service = new QuotationResultService(prisma, pricing as any);
  });

  it('custo pelo retrato e pelas linhas, comissão e tributos', async () => {
    const res = await service.result('q-1');

    expect(res).toMatchObject({
      revenue: 100000,
      productionCost: 42000,
      commission: { percent: 5, value: 5000 },
      taxes: { percent: 10, value: 10000 },
      result: 43000,
      margin: 43,
    });
    const [lona, cartao] = res.items;
    expect(lona).toMatchObject({ total: 80000, cost: 42000, margin: 47.5 });
    expect(lona.lines.map((line) => line.kind)).toEqual(['STAGE', 'LOOSE']);
    expect(lona.lines[0].resolved.map((r) => [r.name, r.cost])).toEqual([
      ['Lona 440', 3750],
      ['Ilhós', 160],
    ]);
    expect(lona.lines[1].resolved).toEqual([
      expect.objectContaining({ kind: 'OUTSOURCED', cost: 12000 }),
    ]);
    // Sem retrato nem linha, o custo do item não é conhecido
    expect(cartao).toMatchObject({ cost: 0, costKnown: false });
  });

  it('orçamento inexistente: 404', async () => {
    prisma.quotation.findUnique.mockResolvedValue(null);
    await expect(service.result('q-9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
