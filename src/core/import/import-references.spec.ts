import { ImportService } from './import.service';

/**
 * A importação financeira exige natureza, subcategoria e conta bancária já
 * cadastradas. Criar conta é feature de plano (em Trial o cliente nem tem a
 * tela) e as naturezas/subcategorias vêm às centenas no extrato de outro
 * sistema — o arquivo inteiro era rejeitado por cadastro que ninguém tinha como
 * adivinhar. Estes testes cobrem o caminho que destrava isso: reportar o que
 * falta e criar a partir do próprio arquivo, mediante confirmação na tela.
 */
describe('ImportService references', () => {
  // Só as colunas relevantes. A terceira linha repete a segunda com caixa e
  // espaços diferentes; a última vem sem nenhuma referência.
  const CSV = [
    'sep=;',
    'Tipo;Natureza;SubCategoria;ContaBancaria',
    'RECEITA;Vendas;Outros Investimentos;Sicredi CC 47204-3',
    'DESPESA;Operacional;Água;Bradesco CC 8392-5',
    'DESPESA; operacional ; água ; bradesco cc 8392-5 ',
    'RECEITA;;;',
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
      nature: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'nature-new' }),
        update: jest.fn().mockResolvedValue({}),
      },
      subCategory: {
        findFirst: jest.fn().mockResolvedValue(null),
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

    const service = new ImportService(prisma, {} as any, {} as any);

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
    it('reporta os cadastros ausentes por tipo, sem repetir variação de caixa', async () => {
      const service = await buildService();

      const result = await service.validateCsv('import-1');

      expect(result.missingRecords).toEqual([
        { type: 'nature', name: 'Vendas' },
        { type: 'nature', name: 'Operacional' },
        {
          type: 'subCategory',
          name: 'Outros Investimentos',
          parent: 'Vendas',
        },
        { type: 'subCategory', name: 'Água', parent: 'Operacional' },
        { type: 'bankAccount', name: 'Sicredi CC 47204-3' },
        { type: 'bankAccount', name: 'Bradesco CC 8392-5' },
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
        nature: {
          findFirst: jest.fn().mockResolvedValue({ id: 'nature-1' }),
          create: jest.fn(),
          update: jest.fn(),
        },
        subCategory: {
          findFirst: jest.fn().mockResolvedValue({ id: 'sub-1' }),
          create: jest.fn(),
          update: jest.fn(),
        },
      });

      const result = await service.validateCsv('import-1');

      expect(result.missingRecords).toEqual([]);
      expect(prisma.nature.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            description: { equals: 'Vendas', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('não busca cadastros em importação que não é financeira', async () => {
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

      expect(result.missingRecords).toEqual([]);
      expect(prisma.bankAccount.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('createMissingReferences', () => {
    it('cria natureza, subcategoria e conta bancária do arquivo', async () => {
      const service = await buildService();

      const result = await service.createMissingReferences('import-1');

      expect(result.created).toEqual([
        { type: 'nature', name: 'Vendas' },
        { type: 'nature', name: 'Operacional' },
        { type: 'subCategory', name: 'Outros Investimentos' },
        { type: 'subCategory', name: 'Água' },
        { type: 'bankAccount', name: 'Sicredi CC 47204-3' },
        { type: 'bankAccount', name: 'Bradesco CC 8392-5' },
      ]);

      expect(prisma.nature.create).toHaveBeenCalledTimes(2);
      expect(prisma.subCategory.create).toHaveBeenCalledTimes(2);
      expect(prisma.bankAccount.create).toHaveBeenCalledTimes(2);
    });

    it('pendura a subcategoria na natureza declarada na linha', async () => {
      const service = await buildService({
        nature: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              id: `nature-${data.description.toLowerCase()}`,
            }),
          ),
          update: jest.fn(),
        },
      });

      await service.createMissingReferences('import-1');

      // Usa o id da natureza recém-criada, sem depender de reconsultar o banco.
      const { data } = prisma.subCategory.create.mock.calls[0][0];
      expect(data.description).toBe('Outros Investimentos');
      expect(data.natureId).toBe('nature-vendas');
      expect(data.companyId).toBe('company-1');

      const segunda = prisma.subCategory.create.mock.calls[1][0].data;
      expect(segunda.description).toBe('Água');
      expect(segunda.natureId).toBe('nature-operacional');
    });

    it('cria a conta bancária com o banco genérico e o controle de caixa', async () => {
      const service = await buildService();

      await service.createMissingReferences('import-1');

      const { data } = prisma.bankAccount.create.mock.calls[0][0];
      expect(data.name).toBe('Sicredi CC 47204-3');
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

    it('reativa registro inativo de mesmo nome em vez de duplicar', async () => {
      const inactiveOnly = (model: string) => ({
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              where.isActive ? null : { id: `${model}-old`, name: 'Reativada' },
            ),
          ),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      });

      const service = await buildService({
        bankAccount: inactiveOnly('acc'),
        nature: inactiveOnly('nature'),
        subCategory: inactiveOnly('sub'),
      });

      const result = await service.createMissingReferences('import-1');

      expect(result.created).toEqual([]);
      expect(result.reactivated).toHaveLength(6);
      expect(prisma.bankAccount.create).not.toHaveBeenCalled();
      expect(prisma.nature.create).not.toHaveBeenCalled();
      expect(prisma.subCategory.create).not.toHaveBeenCalled();
    });

    it('ignora cadastro que já está ativo', async () => {
      const active = (id: string) => ({
        findFirst: jest.fn().mockResolvedValue({ id, name: 'Existente' }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      });

      const service = await buildService({
        bankAccount: active('acc-1'),
        nature: active('nature-1'),
        subCategory: active('sub-1'),
      });

      const result = await service.createMissingReferences('import-1');

      expect(result.created).toEqual([]);
      expect(result.skipped).toHaveLength(6);
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

      await expect(service.createMissingReferences('import-1')).rejects.toThrow(
        /financial imports/,
      );
    });
  });
});
