import { PrismaClient } from '@prisma/client';
import {
  ACCOUNTS_TO_CREATE,
  runCreateBankAccounts,
} from './create-bank-accounts';

const COMPANY_ID = 'company-1';

function buildPrisma(overrides: Record<string, any> = {}) {
  const prisma = {
    company: {
      findUnique: jest.fn().mockResolvedValue({
        id: COMPANY_ID,
        name: 'Cliente Novo',
      }),
    },
    paymentCondition: {
      findMany: jest.fn().mockResolvedValue([{ id: 'pc-1' }, { id: 'pc-2' }]),
    },
    bank: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve({ id: `bank-${where.code}`, name: 'Banco X' }),
        ),
      create: jest.fn().mockResolvedValue({
        id: 'bank-748',
        name: 'Banco Cooperativo Sicredi S.A.',
        code: '748',
      }),
    },
    bankAccount: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };

  return prisma as unknown as PrismaClient;
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('runCreateBankAccounts', () => {
  it('falha quando a empresa não existe', async () => {
    const prisma = buildPrisma({
      company: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await expect(runCreateBankAccounts(prisma, COMPANY_ID)).rejects.toThrow(
      /não encontrada/,
    );
  });

  it('cria todas as contas ausentes com os nomes exatos do CSV', async () => {
    const prisma = buildPrisma();

    const summary = await runCreateBankAccounts(prisma, COMPANY_ID);

    expect(summary).toEqual({ created: 4, reactivated: 0, skipped: 0 });

    const createdNames = (
      prisma.bankAccount.create as jest.Mock
    ).mock.calls.map(([arg]) => arg.data.name);
    expect(createdNames).toEqual(ACCOUNTS_TO_CREATE.map((a) => a.name));
  });

  it('replica as linhas de controle de caixa por condição de pagamento', async () => {
    const prisma = buildPrisma();

    await runCreateBankAccounts(prisma, COMPANY_ID);

    const [firstCall] = (prisma.bankAccount.create as jest.Mock).mock.calls;
    expect(firstCall[0].data.bankAccountCashControl.createMany.data).toEqual([
      {
        paymentConditionId: 'pc-1',
        acceptIncomes: false,
        incomeType: 'PAYSOFF',
        acceptPayments: false,
        paymentType: 'PAYSOFF',
      },
      {
        paymentConditionId: 'pc-2',
        acceptIncomes: false,
        incomeType: 'PAYSOFF',
        acceptPayments: false,
        paymentType: 'PAYSOFF',
      },
    ]);
  });

  it('não duplica contas que já existem ativas', async () => {
    const prisma = buildPrisma({
      bankAccount: {
        findFirst: jest.fn().mockResolvedValue({ id: 'acc-1', isActive: true }),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    const summary = await runCreateBankAccounts(prisma, COMPANY_ID);

    expect(summary).toEqual({ created: 0, reactivated: 0, skipped: 4 });
    expect(prisma.bankAccount.create).not.toHaveBeenCalled();
  });

  it('reativa conta inativa em vez de criar duplicata', async () => {
    const prisma = buildPrisma({
      bankAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'acc-1', isActive: false }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    const summary = await runCreateBankAccounts(prisma, COMPANY_ID);

    expect(summary).toEqual({ created: 0, reactivated: 4, skipped: 0 });
    expect(prisma.bankAccount.create).not.toHaveBeenCalled();
    expect(prisma.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { isActive: true },
    });
  });

  it('cria o banco Sicredi quando ele ainda não existe no catálogo', async () => {
    const prisma = buildPrisma({
      bank: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            where.code === '748'
              ? Promise.resolve(null)
              : Promise.resolve({ id: `bank-${where.code}`, name: 'Banco X' }),
          ),
        create: jest.fn().mockResolvedValue({
          id: 'bank-748',
          name: 'Banco Cooperativo Sicredi S.A.',
          code: '748',
        }),
      },
    });

    await runCreateBankAccounts(prisma, COMPANY_ID);

    expect(prisma.bank.create).toHaveBeenCalledWith({
      data: {
        name: 'Banco Cooperativo Sicredi S.A.',
        code: '748',
        icon: 'bancoCooperativoSicredi',
      },
    });
  });

  it('falha se um código de banco não existir nem na base nem no seed', async () => {
    const prisma = buildPrisma({
      bank: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    });
    const original = [...ACCOUNTS_TO_CREATE];
    ACCOUNTS_TO_CREATE.splice(0, ACCOUNTS_TO_CREATE.length, {
      name: 'Conta Fantasma',
      bankCode: '999',
    });

    await expect(runCreateBankAccounts(prisma, COMPANY_ID)).rejects.toThrow(
      /não existe na base nem em BASE_BANKS/,
    );

    ACCOUNTS_TO_CREATE.splice(0, ACCOUNTS_TO_CREATE.length, ...original);
  });
});
