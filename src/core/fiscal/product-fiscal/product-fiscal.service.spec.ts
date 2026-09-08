import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { ProductFiscalService } from './product-fiscal.service';

/**
 * Foco em bulkUpdateNcm: é a única operação que escreve em vários produtos de
 * uma vez e a única deste service que depende de escopo por empresa.
 */
describe('ProductFiscalService', () => {
  let service: ProductFiscalService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      productFiscalData: {
        updateMany: jest.fn(),
        createMany: jest.fn(),
        upsert: jest.fn(),
        count: jest.fn(),
      },
      productStRule: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      invoicyConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductFiscalService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProductFiscalService>(ProductFiscalService);
    jest.clearAllMocks();
  });

  /**
   * MVA da substituição tributária e alíquota do FCP não são deriváveis: a
   * primeira vem de protocolo entre estados por NCM, a segunda de lei estadual.
   * Se não forem gravadas, o cálculo do Regime Normal fica sem entrada.
   */
  describe('cadastro de ST e FCP', () => {
    beforeEach(() => {
      prisma.product.findUnique.mockResolvedValue({ id: 'produto-1' });
      prisma.productFiscalData.upsert.mockResolvedValue({});
    });

    it('persiste os campos de ST e FCP informados', async () => {
      await service.upsert({
        productId: 'produto-1',
        icmsStMva: 40,
        icmsStReducao: 10,
        icmsStRate: 18,
        fcpRate: 2,
        fcpStRate: 2,
      } as any);

      const { create, update } =
        prisma.productFiscalData.upsert.mock.calls[0][0];
      const esperado = {
        icmsStMva: 40,
        icmsStReducao: 10,
        icmsStRate: 18,
        fcpRate: 2,
        fcpStRate: 2,
      };
      expect(update).toMatchObject(esperado);
      expect(create).toMatchObject(esperado);
    });

    it('grava nulo — e não zero — quando o campo não é informado', async () => {
      await service.upsert({ productId: 'produto-1' } as any);

      const { update } = prisma.productFiscalData.upsert.mock.calls[0][0];
      expect(update.icmsStMva).toBeNull();
      expect(update.fcpRate).toBeNull();
    });

    it('preserva alíquota zero, que é diferente de não cadastrada', async () => {
      await service.upsert({
        productId: 'produto-1',
        fcpRate: 0,
        icmsStMva: 0,
      } as any);

      const { update } = prisma.productFiscalData.upsert.mock.calls[0][0];
      expect(update.fcpRate).toBe(0);
      expect(update.icmsStMva).toBe(0);
    });
  });

  /**
   * A MVA e a alíquota interna vêm de protocolo entre estados e variam por
   * destino: quem vende para todo o país precisa de uma linha por UF, não de um
   * único valor no produto.
   */
  describe('regras de ST por UF', () => {
    beforeEach(() => {
      prisma.product.findUnique.mockResolvedValue({ id: 'produto-1' });
      prisma.productStRule.upsert.mockResolvedValue({});
      prisma.productStRule.deleteMany.mockResolvedValue({ count: 1 });
    });

    it('normaliza a sigla da UF ao gravar', async () => {
      await service.upsertStRule('produto-1', {
        ufDestino: ' sp ',
        mva: 40,
        aliquotaInterna: 18,
      } as any);

      const args = prisma.productStRule.upsert.mock.calls[0][0];
      expect(args.where.productId_ufDestino.ufDestino).toBe('SP');
      expect(args.create).toMatchObject({ ufDestino: 'SP', mva: 40 });
    });

    it('atualiza a linha existente em vez de duplicar a UF', async () => {
      await service.upsertStRule('produto-1', {
        ufDestino: 'SP',
        mva: 45,
      } as any);

      const args = prisma.productStRule.upsert.mock.calls[0][0];
      expect(args.update).toMatchObject({ mva: 45 });
      expect(args.update).not.toHaveProperty('ufDestino');
    });

    it('recusa produto inexistente', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(
        service.upsertStRule('nao-existe', { ufDestino: 'SP' } as any),
      ).rejects.toThrow('Produto não encontrado');
    });

    it('reclama quando a regra a remover não existe', async () => {
      prisma.productStRule.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.removeStRule('produto-1', 'sp')).rejects.toThrow(
        'Regra de ST não encontrada',
      );
    });
  });

  describe('bulkUpdateNcm', () => {
    const COMPANY = 'company-1';

    /**
     * `product.findMany` é chamado duas vezes no escopo SELECTED: primeiro
     * para resolver quais IDs pertencem à empresa, depois para achar quem
     * ainda não tem cadastro fiscal.
     */
    function mockProducts(products: { id: string; hasFiscal: boolean }[]) {
      const daEmpresa = products.map(({ id }) => ({ id }));
      const semCadastro = products
        .filter((p) => !p.hasFiscal)
        .map(({ id }) => ({ id }));

      prisma.product.findMany
        .mockResolvedValueOnce(daEmpresa)
        .mockResolvedValueOnce(semCadastro);
      prisma.productFiscalData.updateMany.mockResolvedValue({
        count: products.filter((p) => p.hasFiscal).length,
      });
      prisma.productFiscalData.createMany.mockResolvedValue({
        count: semCadastro.length,
      });
    }

    /** Escopo ALL não resolve IDs: a primeira busca já é a de quem não tem cadastro. */
    function mockEscopoTodos(semCadastro: string[], atualizados: number) {
      prisma.product.findMany.mockResolvedValue(
        semCadastro.map((id) => ({ id })),
      );
      prisma.productFiscalData.updateMany.mockResolvedValue({
        count: atualizados,
      });
      prisma.productFiscalData.createMany.mockResolvedValue({
        count: semCadastro.length,
      });
    }

    it('rejeita NCM inválido antes de tocar o banco', async () => {
      await expect(
        service.bulkUpdateNcm(COMPANY, { productIds: ['p-1'], ncm: '123' }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it('rejeita o NCM genérico 00000000', async () => {
      await expect(
        service.bulkUpdateNcm(COMPANY, {
          productIds: ['p-1'],
          ncm: '00000000',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('normaliza NCM com máscara antes de gravar', async () => {
      mockProducts([{ id: 'p-1', hasFiscal: true }]);

      const result = await service.bulkUpdateNcm(COMPANY, {
        productIds: ['p-1'],
        ncm: '4911.10.10',
      });

      expect(result.ncm).toBe('49111010');
      expect(prisma.productFiscalData.updateMany).toHaveBeenCalledWith({
        where: { product: { id: { in: ['p-1'] }, companyId: COMPANY } },
        data: { ncm: '49111010' },
      });
    });

    it('filtra por companyId e ignora ids de fora da empresa', async () => {
      mockProducts([{ id: 'p-1', hasFiscal: true }]);

      const result = await service.bulkUpdateNcm(COMPANY, {
        productIds: ['p-1', 'p-de-outra-empresa', 'p-inexistente'],
        ncm: '49111010',
      });

      expect(prisma.product.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: { in: ['p-1', 'p-de-outra-empresa', 'p-inexistente'] },
          companyId: COMPANY,
        },
        select: { id: true },
      });
      expect(result.ignored).toBe(2);
    });

    it('atualiza quem tem cadastro fiscal e cria para quem não tem', async () => {
      mockProducts([
        { id: 'p-1', hasFiscal: true },
        { id: 'p-2', hasFiscal: false },
        { id: 'p-3', hasFiscal: false },
      ]);

      const result = await service.bulkUpdateNcm(COMPANY, {
        productIds: ['p-1', 'p-2', 'p-3'],
        ncm: '49111010',
      });

      const createArgs = prisma.productFiscalData.createMany.mock.calls[0][0];
      expect(createArgs.data).toHaveLength(2);
      expect(createArgs.data[0]).toMatchObject({
        productId: 'p-2',
        ncm: '49111010',
        cfopInState: '5101',
        commercialUnit: 'UN',
      });
      expect(createArgs.skipDuplicates).toBe(true);

      expect(result).toEqual({
        ncm: '49111010',
        scope: 'SELECTED',
        updated: 1,
        created: 2,
        ignored: 0,
        total: 3,
      });
    });

    it('só altera o ncm de quem já tem cadastro, preservando o resto', async () => {
      mockProducts([{ id: 'p-1', hasFiscal: true }]);

      await service.bulkUpdateNcm(COMPANY, {
        productIds: ['p-1'],
        ncm: '49111010',
      });

      const updateArgs = prisma.productFiscalData.updateMany.mock.calls[0][0];
      expect(Object.keys(updateArgs.data)).toEqual(['ncm']);
    });

    it('usa o CFOP padrão do emissor ao criar cadastros', async () => {
      prisma.invoicyConfig.findFirst.mockResolvedValue({
        defaultNcm: '11111111',
        defaultCfop: '5102',
      });
      mockProducts([{ id: 'p-1', hasFiscal: false }]);

      await service.bulkUpdateNcm(COMPANY, {
        productIds: ['p-1'],
        ncm: '49111010',
      });

      const createArgs = prisma.productFiscalData.createMany.mock.calls[0][0];
      // O NCM vem do que o usuário escolheu, não do default do emissor
      expect(createArgs.data[0].ncm).toBe('49111010');
      expect(createArgs.data[0].cfopInState).toBe('5102');
    });

    it('falha quando nenhum id pertence à empresa', async () => {
      prisma.product.findMany.mockResolvedValue([]);

      await expect(
        service.bulkUpdateNcm(COMPANY, {
          productIds: ['p-de-outra-empresa'],
          ncm: '49111010',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.productFiscalData.updateMany).not.toHaveBeenCalled();
    });

    /**
     * CSOSN em emissor do Regime Normal faz o cálculo de imposto recusar a
     * emissão: o produto criado aqui nasceria bloqueado.
     */
    it('cria cadastro com CST 00 quando o emissor é do Regime Normal', async () => {
      prisma.invoicyConfig.findFirst.mockResolvedValue({
        defaultNcm: null,
        defaultCfop: null,
        emitCrt: 3,
      });
      mockProducts([{ id: 'p-1', hasFiscal: false }]);

      await service.bulkUpdateNcm(COMPANY, {
        productIds: ['p-1'],
        ncm: '49111010',
      });

      expect(
        prisma.productFiscalData.createMany.mock.calls[0][0].data[0].icmsCst,
      ).toBe('00');
    });

    it('mantém CSOSN 102 no Simples e quando o emissor não tem CRT', async () => {
      for (const emitCrt of [1, 2, null]) {
        jest.clearAllMocks();
        prisma.invoicyConfig.findFirst.mockResolvedValue({
          defaultNcm: null,
          defaultCfop: null,
          emitCrt,
        });
        mockProducts([{ id: 'p-1', hasFiscal: false }]);

        await service.bulkUpdateNcm(COMPANY, {
          productIds: ['p-1'],
          ncm: '49111010',
        });

        expect(
          prisma.productFiscalData.createMany.mock.calls[0][0].data[0].icmsCst,
        ).toBe('102');
      }
    });

    describe("escopo 'todos os produtos'", () => {
      it('aplica os filtros da listagem com a empresa vinda do token', async () => {
        mockEscopoTodos([], 42);

        const result = await service.bulkUpdateNcm(COMPANY, {
          scope: 'ALL',
          ncm: '49111010',
          filters: { search: 'camisa', status: 'ACTIVE' } as any,
        });

        expect(prisma.productFiscalData.updateMany).toHaveBeenCalledWith({
          where: {
            product: expect.objectContaining({
              companyId: COMPANY,
              isActive: true,
              AND: [
                {
                  OR: [
                    { name: { contains: 'camisa', mode: 'insensitive' } },
                    { code: { contains: 'camisa', mode: 'insensitive' } },
                    {
                      technicalDescription: {
                        contains: 'camisa',
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              ],
            }),
          },
          data: { ncm: '49111010' },
        });
        expect(result).toMatchObject({ scope: 'ALL', updated: 42, total: 42 });
      });

      it('ignora productIds do corpo e não resolve IDs', async () => {
        mockEscopoTodos([], 7);

        await service.bulkUpdateNcm(COMPANY, {
          scope: 'ALL',
          ncm: '49111010',
          productIds: ['p-de-outra-empresa'],
        });

        // Só a busca de quem não tem cadastro fiscal.
        expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
        expect(
          prisma.productFiscalData.updateMany.mock.calls[0][0].where.product,
        ).not.toHaveProperty('id');
      });

      it('cria cadastros em lotes de 500', async () => {
        const ids = Array.from({ length: 1200 }, (_, i) => `p-${i}`);
        prisma.product.findMany.mockResolvedValue(ids.map((id) => ({ id })));
        prisma.productFiscalData.updateMany.mockResolvedValue({ count: 0 });
        prisma.productFiscalData.createMany
          .mockResolvedValueOnce({ count: 500 })
          .mockResolvedValueOnce({ count: 500 })
          .mockResolvedValueOnce({ count: 200 });

        const result = await service.bulkUpdateNcm(COMPANY, {
          scope: 'ALL',
          ncm: '49111010',
        });

        expect(prisma.productFiscalData.createMany).toHaveBeenCalledTimes(3);
        expect(
          prisma.productFiscalData.createMany.mock.calls.map(
            (c: any[]) => c[0].data.length,
          ),
        ).toEqual([500, 500, 200]);
        expect(result.created).toBe(1200);
      });
    });

    describe("filtro 'só sem NCM próprio'", () => {
      it('preserva NCM ajustado à mão e inclui o padrão herdado do emissor', async () => {
        prisma.invoicyConfig.findFirst.mockResolvedValue({
          defaultNcm: '4911.99.00',
          defaultCfop: null,
          emitCrt: 1,
        });
        mockEscopoTodos([], 3);

        await service.bulkUpdateNcm(COMPANY, {
          scope: 'ALL',
          ncm: '49111010',
          onlyInheritedNcm: true,
        });

        expect(
          prisma.productFiscalData.updateMany.mock.calls[0][0].where.OR,
        ).toEqual([{ ncm: null }, { ncm: '' }, { ncm: '49119900' }]);
      });

      it('produto sem cadastro fiscal entra mesmo com o filtro ligado', async () => {
        mockEscopoTodos(['p-novo'], 0);

        const result = await service.bulkUpdateNcm(COMPANY, {
          scope: 'ALL',
          ncm: '49111010',
          onlyInheritedNcm: true,
        });

        expect(result.created).toBe(1);
      });

      it('explica quando todos já têm NCM próprio', async () => {
        mockEscopoTodos([], 0);

        await expect(
          service.bulkUpdateNcm(COMPANY, {
            scope: 'ALL',
            ncm: '49111010',
            onlyInheritedNcm: true,
          }),
        ).rejects.toThrow(/já têm um NCM próprio/);
      });
    });
  });

  describe('contarAlvosBulkNcm', () => {
    const COMPANY = 'company-1';

    it('soma quem tem cadastro fiscal e quem ainda não tem, sem escrever', async () => {
      prisma.productFiscalData.count.mockResolvedValue(8);
      prisma.product.count.mockResolvedValue(5);

      const result = await service.contarAlvosBulkNcm(COMPANY, {
        scope: 'ALL',
        ncm: '49111010',
      });

      expect(result).toEqual({
        total: 13,
        comCadastroFiscal: 8,
        semCadastroFiscal: 5,
      });
      expect(prisma.productFiscalData.updateMany).not.toHaveBeenCalled();
      expect(prisma.productFiscalData.createMany).not.toHaveBeenCalled();
    });
  });
});
