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

/**
 * A conta da operadora de cartão não escolhe banco: fica no banco genérico
 * "Operadora de cartão" e guarda o nome da operadora (revisão de 23/10/2026).
 */
describe('AccountService.create — operadora de cartão', () => {
  function build(genericBank: { id: string } | null) {
    const create = jest.fn().mockResolvedValue({ id: 'account-1' });
    const bankCreate = jest.fn().mockResolvedValue({ id: 'bank-card-new' });
    const prisma = {
      paymentCondition: { count: jest.fn().mockResolvedValue(0) },
      bank: {
        findFirst: jest.fn().mockResolvedValue(genericBank),
        create: bankCreate,
      },
      bankAccount: { updateMany: jest.fn() },
      bankAccountCashControl: { updateMany: jest.fn() },
      $transaction: jest.fn((fn) =>
        fn({
          bankAccount: { create },
          bankAccountCashControl: { updateMany: jest.fn() },
        }),
      ),
    };
    const service = new AccountService(prisma as any, {} as any);
    return { service, create, bankCreate };
  }

  it('sem banco, a operadora fica no banco genérico com o nome dela', async () => {
    const { service, create } = build({ id: 'bank-card' });
    await service.create({
      companyId: 'company-1',
      name: 'Cartões da loja',
      kind: 'CARD',
      operator: ' Cielo ',
    } as any);
    expect(create.mock.calls[0][0].data).toMatchObject({
      bankId: 'bank-card',
      operator: 'Cielo',
      kind: 'CARD',
      cashControl: false,
    });
  });

  it('o banco genérico nasce se faltar', async () => {
    const { service, create, bankCreate } = build(null);
    await service.create({
      companyId: 'company-1',
      name: 'Rede',
      kind: 'CARD',
    } as any);
    expect(bankCreate).toHaveBeenCalledWith({
      data: { code: 'CARD', name: 'Operadora de cartão' },
      select: { id: true },
    });
    expect(create.mock.calls[0][0].data.bankId).toBe('bank-card-new');
  });

  it('conta de banco sem banco é recusada', async () => {
    const { service, create } = build({ id: 'bank-card' });
    await expect(
      service.create({
        companyId: 'company-1',
        name: 'Conta corrente',
        kind: 'BANK',
      } as any),
    ).rejects.toThrow('Escolha o banco da conta');
    expect(create).not.toHaveBeenCalled();
  });

  it('o nome da operadora não fica em conta que não é de cartão', async () => {
    const { service, create } = build({ id: 'bank-card' });
    await service.create({
      companyId: 'company-1',
      name: 'Bradesco',
      kind: 'BANK',
      bankId: 'bank-237',
      operator: 'Cielo',
    } as any);
    expect(create.mock.calls[0][0].data).toMatchObject({
      bankId: 'bank-237',
      operator: null,
    });
  });
});

describe('CreateBankAccountDto — banco', () => {
  const errorsOf = async (body: Record<string, unknown>) => {
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');
    const { CreateBankAccountDto } = await import('./dto/create-account.dto');
    const errors = await validate(plainToInstance(CreateBankAccountDto, body));
    return errors.map((error) => error.property);
  };

  it('a operadora de cartão passa sem banco', async () => {
    expect(await errorsOf({ name: 'Rede', kind: 'CARD' })).toEqual([]);
  });

  it('a conta de banco sem banco não passa', async () => {
    expect(await errorsOf({ name: 'Bradesco', kind: 'BANK' })).toEqual([
      'bankId',
    ]);
  });
});
