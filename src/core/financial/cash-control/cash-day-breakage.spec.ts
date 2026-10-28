import { CashDayService } from './cash-day.service';

/**
 * O valor do fechamento da frente de caixa a aprovar traz a quebra ligada
 * (pacote de 27/10/2026, 4.1.3): um pedido só, com a quebra como detalhe.
 */
describe('CashDayService.detail — quebra ligada ao fechamento', () => {
  const movement = (overrides: Record<string, unknown>) => ({
    id: 'm',
    type: 'INCOME',
    kind: null,
    amount: 0,
    description: '',
    transactionDate: new Date('2026-10-27T15:00:00Z'),
    operationDate: new Date('2026-10-27T15:00:00Z'),
    retroactive: false,
    awaitingApproval: false,
    approvedByName: null,
    responsibleName: 'Caixa',
    reason: null,
    natureId: null,
    subCategoryId: null,
    linkedId: null,
    paymentConditionId: null,
    receivableInstallment: [],
    payableInstallment: [],
    ...overrides,
  });

  it('o dinheiro a aprovar mostra a quebra no nome do operador', async () => {
    const day = {
      id: 'dia-1',
      number: 3,
      bankAccountId: 'gaveta',
      openingDate: new Date('2026-10-27T15:00:00Z'),
      openingBalance: 0,
      status: 'OPEN',
      openedByName: 'Sistema',
      createdAt: new Date('2026-10-27T12:00:00Z'),
      closedByName: null,
      closingDate: null,
      closedBySystem: false,
      informed: null,
      notes: null,
      reopenings: [],
      transactions: [
        movement({
          id: 'transfer',
          type: 'TRANSFER_INCOME',
          amount: 845,
          description: 'Fechamento FC nº 7 · Dinheiro',
          awaitingApproval: true,
          linkedId: 'fechamento-7',
        }),
        movement({
          id: 'quebra',
          type: 'OUTCOME',
          kind: 'SHORTAGE',
          amount: 5,
          description: 'Diferença da contagem · FC nº 7',
          responsibleName: 'Paulo',
          linkedId: 'fechamento-7',
        }),
        movement({ id: 'outro', amount: 10, awaitingApproval: true }),
      ],
    };
    const prisma = {
      cashRegister: { findFirst: jest.fn().mockResolvedValue(day) },
      receivableInstallment: { findMany: jest.fn().mockResolvedValue([]) },
      payableInstallment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CashDayService(prisma as any);

    const view = await service.detail('empresa-a', 'dia-1');
    const byId = new Map(view.movements.map((m: any) => [m.id, m]));

    expect(byId.get('transfer')).toEqual(
      expect.objectContaining({
        amount: 84500,
        awaitingApproval: true,
        breakage: { amount: 500, direction: 'SHORTAGE', responsible: 'Paulo' },
      }),
    );
    expect(byId.get('outro')).not.toHaveProperty('breakage');
    expect(byId.get('quebra')).not.toHaveProperty('breakage');
  });
});
