import { BadRequestException } from '@nestjs/common';
import { AccountService } from './account.service';

/**
 * O saldo inicial pela rota comum (PATCH /bank/account/:id): com lançamento
 * na conta, nem a data nem o valor mudam, porque mudariam a abertura dos
 * caixas seguintes (revisão de 23/10/2026). Sem lançamento, mudam.
 */
describe('AccountService.update — saldo inicial', () => {
  const owner = {
    companyId: 'company-1',
    kind: 'CASH',
    cashControl: true,
    openingDate: new Date('2026-10-01T00:00:00.000Z'),
    openingBalance: 150.5,
  };

  function build(withHistory: boolean) {
    const update = jest.fn().mockResolvedValue({ id: 'account-1' });
    const tx = {
      bankAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'account-1', bankAccountCashControl: [] }),
        update,
      },
    };
    const prisma = {
      bankAccount: { findUnique: jest.fn().mockResolvedValue(owner) },
      paymentCondition: { count: jest.fn().mockResolvedValue(0) },
      transaction: {
        groupBy: jest
          .fn()
          .mockResolvedValue(
            withHistory ? [{ bankAccountId: 'account-1' }] : [],
          ),
      },
      cashRegister: { groupBy: jest.fn().mockResolvedValue([]) },
      receivableInstallment: { groupBy: jest.fn().mockResolvedValue([]) },
      payableInstallment: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const service = new AccountService(prisma as any, {} as any);
    return { service, update };
  }

  it('recusa trocar o valor com a conta já movimentada', async () => {
    const { service, update } = build(true);
    await expect(
      service.update('account-1', {
        openingBalance: 20000,
        openingDate: '2026-10-01',
      } as any),
    ).rejects.toThrow(
      new BadRequestException(
        'O saldo inicial não muda depois que a conta tem lançamentos',
      ),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('recusa trocar a data com a conta já movimentada', async () => {
    const { service } = build(true);
    await expect(
      service.update('account-1', {
        openingBalance: 15050,
        openingDate: '2026-10-05',
      } as any),
    ).rejects.toThrow(
      'A data do saldo inicial não muda depois que a conta tem lançamentos',
    );
  });

  it('o mesmo valor e a mesma data não são troca', async () => {
    const { service, update } = build(true);
    await service.update('account-1', {
      name: 'Gaveta',
      openingBalance: 15050,
      openingDate: '2026-10-01',
    } as any);
    expect(update).toHaveBeenCalled();
  });

  it('sem lançamento, o valor muda', async () => {
    const { service, update } = build(false);
    await service.update('account-1', {
      openingBalance: 20000,
      openingDate: '2026-10-01',
    } as any);
    expect(update.mock.calls[0][0].data.openingBalance).toBe(200);
  });
});
