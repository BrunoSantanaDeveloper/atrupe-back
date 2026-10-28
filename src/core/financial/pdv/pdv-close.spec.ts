import { PdvService } from './pdv.service';
import * as ledger from '../cash-control/cash-ledger';

jest.mock('../cash-control/cash-ledger', () => ({
  ...jest.requireActual('../cash-control/cash-ledger'),
  postMovement: jest.fn(),
  findPostingRegister: jest.fn(),
}));

/**
 * O fechamento da frente de caixa (pacote de 27/10/2026, 4.1): o sistema
 * abre o dia da conta que falta, a parte sem conta acha a conta da forma, e
 * a taxa do cartão é a da linha das parcelas.
 */
describe('PdvService.close', () => {
  const user = { userId: 'u1', companyId: 'empresa-a' } as any;
  const actor = { id: 'u1', name: 'Caixa' } as any;
  const postMovement = ledger.postMovement as jest.Mock;
  const findPostingRegister = ledger.findPostingRegister as jest.Mock;

  beforeEach(() => {
    postMovement.mockReset();
    findPostingRegister.mockReset().mockResolvedValue({ register: {} });
  });

  function setup(
    parts: Record<string, unknown>[],
    {
      rule = { bankAccountId: 'banco-pix' } as { bankAccountId: string } | null,
    } = {},
  ) {
    const session = {
      id: 's1',
      number: 7,
      operatorId: 'u1',
      operatorName: 'Caixa',
      openingBalance: 0,
      openedAt: new Date(),
      cashFront: { shortageTolerance: null, drawerAccountId: 'gaveta' },
      movements: [{ kind: 'SALE', parts }],
    };
    const tx = {
      cashSession: { update: jest.fn() },
      pendingSale: { updateMany: jest.fn() },
    };
    const prisma = {
      installment: {
        findMany: jest.fn().mockResolvedValue([
          { paymentConditionId: 'credito', installment: 1, operatorFeeRate: 2 },
          {
            paymentConditionId: 'credito',
            installment: 3,
            operatorFeeRate: 4.5,
          },
        ]),
      },
      bankAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ cashControl: true, kind: 'CASH' }),
      },
      bankAccountCashControl: { findFirst: jest.fn().mockResolvedValue(rule) },
      pendingSale: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };
    const cashDay = { open: jest.fn().mockResolvedValue({}) };
    const service = new PdvService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      cashDay as any,
    );
    Object.assign(service as any, {
      ownSession: jest.fn().mockResolvedValue(session),
      drawerAccount: jest
        .fn()
        .mockResolvedValue({ id: 'gaveta', name: 'Caixa Empresa' }),
      accountNames: jest.fn().mockResolvedValue(new Map()),
    });
    return { service, prisma, cashDay };
  }

  it('o cartão em 3x prevê a taxa da linha de 3 parcelas', async () => {
    const { service } = setup([
      {
        method: 'CARD',
        paymentConditionId: 'credito',
        bankAccountId: 'operadora',
        amount: 10000,
        installments: 3,
      },
    ]);
    const result = await service.close(
      user,
      's1',
      { countedCash: 0 } as any,
      actor,
    );
    expect(result.transfers).toEqual([
      expect.objectContaining({ method: 'CARD', amount: 10000, net: 9550 }),
    ]);
  });

  it('sem a linha das parcelas, vale a taxa de 1x', async () => {
    const { service } = setup([
      {
        method: 'CARD',
        paymentConditionId: 'credito',
        bankAccountId: 'operadora',
        amount: 10000,
        installments: 6,
      },
    ]);
    const result = await service.close(
      user,
      's1',
      { countedCash: 0 } as any,
      actor,
    );
    expect(result.transfers[0].net).toBe(9800);
  });

  it('o PIX gravado sem conta vai para a conta que recebe a forma', async () => {
    const { service } = setup([
      { method: 'PIX', paymentConditionId: 'pix', amount: 5000 },
    ]);
    const result = await service.close(
      user,
      's1',
      { countedCash: 0 } as any,
      actor,
    );
    expect(result.transfers).toEqual([
      expect.objectContaining({ method: 'PIX', bankAccountId: 'banco-pix' }),
    ]);
  });

  it('sem nenhuma conta para a forma, recusa dizendo qual', async () => {
    const { service } = setup(
      [{ method: 'PIX', paymentConditionId: 'pix', amount: 5000 }],
      { rule: null },
    );
    await expect(
      service.close(user, 's1', { countedCash: 0 } as any, actor),
    ).rejects.toThrow('Nenhuma conta ativa recebe PIX');
    expect(postMovement).not.toHaveBeenCalled();
  });

  it('a gaveta sem caixa aberto: o sistema abre o dia e lança', async () => {
    findPostingRegister.mockResolvedValue(null);
    const { service, cashDay } = setup([
      { method: 'CASH', paymentConditionId: 'dinheiro', amount: 8000 },
    ]);
    await service.close(user, 's1', { countedCash: 8000 } as any, actor);
    expect(cashDay.open).toHaveBeenCalledWith(
      'empresa-a',
      { bankAccountId: 'gaveta' },
      { id: null, name: 'Sistema' },
    );
    expect(postMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bankAccountId: 'gaveta',
        withoutRegisterFallback: true,
      }),
    );
  });
});
