import { ImportService } from './import.service';

/**
 * A importação financeira exige conta bancária cadastrada, mas criar conta é
 * feature de plano — em Trial o cliente não tem a tela e ficava sem saída. Estes
 * testes cobrem o caminho que destrava isso: reportar as contas ausentes e
 * criá-las a partir do próprio arquivo, mediante confirmação na tela.
 */
describe('ImportService bank accounts', () => {
  // Só as colunas relevantes: o que importa aqui é a ContaBancaria. A última
  // linha vem sem conta (campo opcional) e a terceira repete a segunda com caixa
  // e espaços diferentes.
  const CSV = [
    'sep=;',
    'Tipo;ContaBancaria',
    'RECEITA;Sicredi CC 47204-3',
    'RECEITA;Bradesco CC 8392-5',
    'RECEITA; bradesco cc 8392-5 ',
    'RECEITA;',
  ].join('\n');

  const IMPORT_LOG = {
    id: 'import-1',
    entity: 'financial',
    companyId: 'company-1',
    status: 'QUEUED',
  };

  let prisma: any;

  async function buildService(overrides: Record<string, any> = {}) {
    prisma = {
      importLog: {
        create: jest.fn().mockResolvedValue(IMPORT_LOG),
        findUnique: jest.fn().mockResolvedValue(IMPORT_LOG),
        update: jest.fn().mockResolvedValue(IMPORT_LOG),
      },
      bankAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      bank: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bank-000', code: '000' }),
      },
      paymentCondition: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pc-1' }, { id: 'pc-2' }]),
      },
      ...overrides,
    };

    const service = new ImportService(prisma, {} as any);

    // Popula o buffer em memória do serviço, que é de onde os dois fluxos leem.
    await service.createImport(
      {
        originalname: 'extrato.csv',
        buffer: Buffer.from(CSV, 'utf-8'),
        size: CSV.length,
      } as any,
      'financial',
      'user-1',
      'company-1',
    );

    return service;
  }

  describe('validateCsv', () => {
    it('reporta as contas ausentes sem repetir variação de caixa', async () => {
      const service = await buildService();

      const result = await service.validateCsv('import-1');

      expect(result.missingBankAccounts).toEqual([
        'Sicredi CC 47204-3',
        'Bradesco CC 8392-5',
      ]);
    });

    it('aceita divergência de caixa e espaços no nome cadastrado', async () => {
      const service = await buildService({
        bankAccount: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'acc-1', name: 'Bradesco CC 8392-5' }),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          update: jest.fn(),
        },
      });

      const result = await service.validateCsv('import-1');

      expect(result.missingBankAccounts).toEqual([]);
      expect(prisma.bankAccount.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: { equals: 'Sicredi CC 47204-3', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('não busca contas em importação que não é financeira', async () => {
      const service = await buildService({
        importLog: {
          create: jest
            .fn()
            .mockResolvedValue({ ...IMPORT_LOG, entity: 'client' }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...IMPORT_LOG, entity: 'client' }),
          update: jest.fn().mockResolvedValue({}),
        },
      });

      const result = await service.validateCsv('import-1');

      expect(result.missingBankAccounts).toEqual([]);
      expect(prisma.bankAccount.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('createMissingBankAccounts', () => {
    it('cria as contas do arquivo com o banco genérico e o controle de caixa', async () => {
      const service = await buildService();

      const result = await service.createMissingBankAccounts('import-1');

      expect(result.created).toEqual([
        'Sicredi CC 47204-3',
        'Bradesco CC 8392-5',
      ]);
      expect(prisma.bankAccount.create).toHaveBeenCalledTimes(2);

      const { data } = prisma.bankAccount.create.mock.calls[0][0];
      expect(data.name).toBe('Sicredi CC 47204-3');
      expect(data.companyId).toBe('company-1');
      expect(data.bankId).toBe('bank-000');
      expect(data.cashControl).toBe(true);
      // Uma linha de controle de caixa por condição de pagamento ativa, como na tela.
      expect(data.bankAccountCashControl.createMany.data).toHaveLength(2);
      expect(data.bankAccountCashControl.createMany.data[0]).toMatchObject({
        paymentConditionId: 'pc-1',
        acceptIncomes: false,
        acceptPayments: false,
      });
    });

    it('reativa conta inativa de mesmo nome em vez de duplicar', async () => {
      const service = await buildService({
        bankAccount: {
          // Sem conta ativa; existe uma inativa com o mesmo nome.
          findFirst: jest
            .fn()
            .mockImplementation(({ where }) =>
              Promise.resolve(
                where.isActive
                  ? null
                  : { id: `acc-${where.name.equals}`, name: where.name.equals },
              ),
            ),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
      });

      const result = await service.createMissingBankAccounts('import-1');

      expect(result.created).toEqual([]);
      expect(result.reactivated).toEqual([
        'Sicredi CC 47204-3',
        'Bradesco CC 8392-5',
      ]);
      expect(prisma.bankAccount.create).not.toHaveBeenCalled();
      expect(prisma.bankAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: true } }),
      );
    });

    it('ignora conta que já está ativa', async () => {
      const service = await buildService({
        bankAccount: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'acc-1', name: 'Conta existente' }),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          update: jest.fn(),
        },
      });

      const result = await service.createMissingBankAccounts('import-1');

      expect(result.created).toEqual([]);
      expect(result.skipped).toHaveLength(2);
      expect(prisma.bankAccount.create).not.toHaveBeenCalled();
    });

    it('recusa importação que não é financeira', async () => {
      const service = await buildService({
        importLog: {
          create: jest
            .fn()
            .mockResolvedValue({ ...IMPORT_LOG, entity: 'client' }),
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...IMPORT_LOG, entity: 'client' }),
          update: jest.fn(),
        },
      });

      await expect(
        service.createMissingBankAccounts('import-1'),
      ).rejects.toThrow(/financial imports/);
    });
  });
});
