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
    // O banco guarda centavos, como a API (17/11/2026)
    openingBalance: 15050,
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
    expect(update.mock.calls[0][0].data.openingBalance).toBe(20000);
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

/**
 * A conta onde a operadora de cartão deposita (12/11/2026): da empresa,
 * ativa, que não é outra operadora nem a própria; a conta onde alguma
 * operadora deposita não se inativa sem trocar a ligação.
 */
describe('AccountService — conta onde cai', () => {
  function build(target: Record<string, unknown> | null) {
    const create = jest.fn().mockResolvedValue({ id: 'card-1' });
    const prisma = {
      paymentCondition: { count: jest.fn().mockResolvedValue(0) },
      bank: { findFirst: jest.fn().mockResolvedValue({ id: 'bank-card' }) },
      bankAccount: {
        updateMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(target),
      },
      bankAccountCashControl: { updateMany: jest.fn() },
      $transaction: jest.fn((fn) =>
        fn({
          bankAccount: { create },
          bankAccountCashControl: { updateMany: jest.fn() },
        }),
      ),
    };
    const service = new AccountService(prisma as any, {} as any);
    return { service, create, prisma };
  }
  const card = (settlementAccountId: string) =>
    ({
      companyId: 'company-1',
      name: 'Stone',
      kind: 'CARD',
      settlementAccountId,
    }) as any;

  it('liga a operadora à conta do banco da empresa', async () => {
    const { service, create, prisma } = build({
      id: 'bank-itau',
      kind: 'BANK',
      isActive: true,
    });
    await service.create(card('bank-itau'));
    expect(create.mock.calls[0][0].data.settlementAccountId).toBe('bank-itau');
    expect(prisma.bankAccount.findFirst.mock.calls[0][0].where).toEqual({
      id: 'bank-itau',
      companyId: 'company-1',
    });
  });

  it('outra operadora não é conta onde cai', async () => {
    const { service } = build({ id: 'card-2', kind: 'CARD', isActive: true });
    await expect(service.create(card('card-2'))).rejects.toThrow(
      'A conta onde cai é a do banco, não outra operadora de cartão',
    );
  });

  it('conta de outra empresa ou inexistente: 404', async () => {
    const { service } = build(null);
    await expect(service.create(card('bank-x'))).rejects.toThrow(
      'Conta onde cai não encontrada',
    );
  });

  it('conta que não é de cartão não guarda a ligação', async () => {
    const { service, create, prisma } = build(null);
    await service.create({
      companyId: 'company-1',
      name: 'Itaú',
      kind: 'BANK',
      bankId: 'bank-itau',
      settlementAccountId: 'bank-x',
    } as any);
    expect(create.mock.calls[0][0].data.settlementAccountId).toBeNull();
    expect(prisma.bankAccount.findFirst).not.toHaveBeenCalled();
  });

  it('a conta onde uma operadora deposita não se inativa e diz o caminho', async () => {
    const prisma = {
      bankAccount: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'bank-itau',
          cashControl: false,
          kind: 'BANK',
          openingBalance: 0,
          openingDate: null,
        }),
        findMany: jest.fn().mockResolvedValue([{ name: 'Stone' }]),
      },
      cashRegister: { count: jest.fn().mockResolvedValue(0) },
    };
    const cashDay = { accountBalance: jest.fn().mockResolvedValue(0) };
    const service = new AccountService(prisma as any, cashDay as any);
    await expect(
      (service as any).assertCanInactivate('bank-itau'),
    ).rejects.toThrow(
      'Stone deposita nesta conta. Troque a conta onde cai da operadora antes de inativar.',
    );
  });
});
