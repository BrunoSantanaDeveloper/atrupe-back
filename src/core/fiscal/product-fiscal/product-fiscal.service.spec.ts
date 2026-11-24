import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { ProductFiscalService } from './product-fiscal.service';
import { IcmsAliquotaInternaService } from '../shared/icms-aliquota-interna.service';

/**
 * Foco nas operações em massa (NCM e tributação): são as únicas que escrevem
 * em vários produtos de uma vez e as únicas deste service que dependem de
 * escopo por empresa.
 */
describe('ProductFiscalService', () => {
  let service: ProductFiscalService;
  let prisma: any;
  let aliquotaInterna: { listar: jest.Mock };

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
      address: { findMany: jest.fn().mockResolvedValue([]) },
      invoicyConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
    };

    aliquotaInterna = { listar: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductFiscalService,
        { provide: PrismaService, useValue: prisma },
        { provide: IcmsAliquotaInternaService, useValue: aliquotaInterna },
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

  /**
   * A correção de tributação em massa escreve em centenas de cadastros de uma
   * vez e é o caminho de quem acabou de migrar de regime fiscal: o que ela
   * aceita gravar precisa estar coberto por teste, porque o erro só aparece na
   * emissão da nota do cliente.
   */
  describe('bulkUpdateTributacao', () => {
    const COMPANY = 'company-1';
    const REGIME_NORMAL = 3;
    const SIMPLES = 1;

    /** Emissor da empresa, de onde sai o regime que valida o CST. */
    function mockEmissor(emitCrt: number | null, extras: any = {}) {
      prisma.invoicyConfig.findFirst.mockResolvedValue({
        emitCrt,
        defaultNcm: null,
        defaultCfop: null,
        ...extras,
      });
    }

    /**
     * `product.findMany` é chamado duas vezes no escopo SELECTED: primeiro
     * para resolver quais IDs pertencem à empresa, depois para achar quem
     * ainda não tem cadastro fiscal.
     */
    function mockProdutos(produtos: { id: string; hasFiscal: boolean }[]) {
      const semCadastro = produtos
        .filter((p) => !p.hasFiscal)
        .map(({ id }) => ({ id }));

      prisma.product.findMany
        .mockResolvedValueOnce(produtos.map(({ id }) => ({ id })))
        .mockResolvedValueOnce(semCadastro);
      prisma.productFiscalData.updateMany.mockResolvedValue({
        count: produtos.filter((p) => p.hasFiscal).length,
      });
      prisma.productFiscalData.createMany.mockResolvedValue({
        count: semCadastro.length,
      });
      // Nenhum produto sem alíquota, salvo quando o teste disser o contrário.
      prisma.productFiscalData.count.mockResolvedValue(0);
    }

    it('recusa CSOSN em emissor do Regime Normal antes de tocar o banco', async () => {
      mockEmissor(REGIME_NORMAL);

      await expect(
        service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '102',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.product.findMany).not.toHaveBeenCalled();
      expect(prisma.productFiscalData.updateMany).not.toHaveBeenCalled();
    });

    it('recusa CST do Regime Normal em optante do Simples', async () => {
      mockEmissor(SIMPLES);

      await expect(
        service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '00',
          icmsRate: 17,
        }),
      ).rejects.toThrow(/Simples/);

      expect(prisma.productFiscalData.updateMany).not.toHaveBeenCalled();
    });

    it('recusa CST que o sistema ainda não calcula', async () => {
      mockEmissor(REGIME_NORMAL);

      await expect(
        service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '90',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa requisição sem nenhum campo de tributação', async () => {
      mockEmissor(REGIME_NORMAL);

      await expect(
        service.bulkUpdateTributacao(COMPANY, { productIds: ['p-1'] }),
      ).rejects.toThrow(/pelo menos um campo/);
    });

    /**
     * O defeito que motivou a conferência: trocar CSOSN 102 por CST 00 sem
     * alíquota só troca a mensagem de recusa na emissão.
     */
    it('recusa CST que exige alíquota quando os produtos não têm e ela não vem na correção', async () => {
      mockEmissor(REGIME_NORMAL);
      prisma.product.findMany
        .mockResolvedValueOnce([{ id: 'p-1' }, { id: 'p-2' }])
        .mockResolvedValueOnce([]);
      prisma.productFiscalData.count.mockResolvedValue(118);

      await expect(
        service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1', 'p-2'],
          icmsCst: '00',
        }),
      ).rejects.toThrow(/118 produto\(s\)/);

      expect(prisma.productFiscalData.updateMany).not.toHaveBeenCalled();
    });

    it('aceita CST que exige alíquota quando todos os produtos já têm uma', async () => {
      mockEmissor(REGIME_NORMAL);
      mockProdutos([{ id: 'p-1', hasFiscal: true }]);

      const result = await service.bulkUpdateTributacao(COMPANY, {
        productIds: ['p-1'],
        icmsCst: '00',
      });

      expect(result.total).toBe(1);
      expect(prisma.productFiscalData.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { icmsCst: '00' } }),
      );
    });

    it('aceita CST que exige alíquota quando a alíquota vem na mesma correção', async () => {
      mockEmissor(REGIME_NORMAL);
      mockProdutos([{ id: 'p-1', hasFiscal: true }]);
      // Mesmo com produtos sem alíquota no banco, a correção os preenche.
      prisma.productFiscalData.count.mockResolvedValue(50);

      await service.bulkUpdateTributacao(COMPANY, {
        productIds: ['p-1'],
        icmsCst: '00',
        icmsRate: 17,
      });

      expect(prisma.productFiscalData.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { icmsCst: '00', icmsRate: 17 } }),
      );
    });

    /**
     * Numa base migrada a alíquota preenchida é a exceção deliberada — o
     * produto que alguém conferiu. Sobrescrevê-la junto do CST apagaria em
     * silêncio o único dado revisado da base.
     */
    describe("filtro 'alíquota só de quem está sem'", () => {
      it('escreve a alíquota apenas em quem está sem, e o CST em todos', async () => {
        mockEmissor(REGIME_NORMAL);
        prisma.product.findMany
          .mockResolvedValueOnce([{ id: 'p-1' }])
          .mockResolvedValueOnce([]);
        prisma.productFiscalData.count.mockResolvedValue(0);
        prisma.productFiscalData.updateMany
          .mockResolvedValueOnce({ count: 118 })
          .mockResolvedValueOnce({ count: 119 });

        const result = await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '00',
          icmsRate: 17,
          onlyMissingRate: true,
        });

        const [primeira, segunda] =
          prisma.productFiscalData.updateMany.mock.calls;
        expect(primeira[0]).toMatchObject({ data: { icmsRate: 17 } });
        expect(primeira[0].where.AND[1]).toEqual({ icmsRate: null });
        expect(segunda[0]).toMatchObject({ data: { icmsCst: '00' } });
        expect(segunda[0].where.AND).toBeUndefined();
        // Quantos produtos a correção tocou: o passo que atinge todos.
        expect(result.updated).toBe(119);
      });

      it('com a alíquota como único campo, conta o passo da alíquota', async () => {
        mockEmissor(REGIME_NORMAL);
        prisma.product.findMany
          .mockResolvedValueOnce([{ id: 'p-1' }])
          .mockResolvedValueOnce([]);
        prisma.productFiscalData.count.mockResolvedValue(0);
        prisma.productFiscalData.updateMany.mockResolvedValue({ count: 118 });

        const result = await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsRate: 17,
          onlyMissingRate: true,
        });

        expect(prisma.productFiscalData.updateMany).toHaveBeenCalledTimes(1);
        expect(result.updated).toBe(118);
      });

      it('desligado, grava tudo de uma vez', async () => {
        mockEmissor(REGIME_NORMAL);
        mockProdutos([{ id: 'p-1', hasFiscal: true }]);

        await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '00',
          icmsRate: 17,
        });

        expect(prisma.productFiscalData.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.productFiscalData.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: { icmsCst: '00', icmsRate: 17 } }),
        );
      });

      /** Cadastro novo não tem alíquota: recebe a informada de qualquer modo. */
      it('cadastro criado recebe a alíquota mesmo com o filtro ligado', async () => {
        mockEmissor(REGIME_NORMAL);
        mockProdutos([{ id: 'p-1', hasFiscal: false }]);

        await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '00',
          icmsRate: 17,
          onlyMissingRate: true,
        });

        expect(prisma.productFiscalData.createMany).toHaveBeenCalledWith({
          data: [expect.objectContaining({ icmsCst: '00', icmsRate: 17 })],
          skipDuplicates: true,
        });
      });
    });

    it('recusa CST com redução de base sem o percentual de redução', async () => {
      mockEmissor(REGIME_NORMAL);
      prisma.product.findMany
        .mockResolvedValueOnce([{ id: 'p-1' }])
        .mockResolvedValueOnce([]);
      prisma.productFiscalData.count.mockResolvedValue(3);

      await expect(
        service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '20',
          icmsRate: 17,
        }),
      ).rejects.toThrow(/redução da base/);
    });

    it('recusa redução de base fora do intervalo aberto 0-100', async () => {
      mockEmissor(REGIME_NORMAL);

      for (const icmsReducao of [0, 100]) {
        await expect(
          service.bulkUpdateTributacao(COMPANY, {
            productIds: ['p-1'],
            icmsReducao,
          }),
        ).rejects.toThrow(/entre 0 e 100/);
      }
    });

    /**
     * A unidade comercial decide se a linha da nota sai em peças ou na medida
     * do item: produto de área cadastrado como UN emite "1 UN x R$ 13.220" no
     * lugar de "32,2 M2 x R$ 369,50". Sem correção em massa, arrumar isso
     * numa base inteira é produto a produto.
     */
    describe('unidade comercial', () => {
      it('grava a unidade normalizada como uCom', async () => {
        mockEmissor(SIMPLES);
        mockProdutos([{ id: 'p-1', hasFiscal: true }]);

        await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          commercialUnit: 'm²',
        });

        expect(prisma.productFiscalData.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: { commercialUnit: 'M2' } }),
        );
      });

      it('aceita a unidade como único campo da correção', async () => {
        mockEmissor(SIMPLES);
        mockProdutos([{ id: 'p-1', hasFiscal: true }]);

        const result = await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          commercialUnit: 'UN',
        });

        expect(result.total).toBe(1);
      });

      it('recusa unidade sem caractere aproveitável', async () => {
        mockEmissor(SIMPLES);

        await expect(
          service.bulkUpdateTributacao(COMPANY, {
            productIds: ['p-1'],
            commercialUnit: '   ',
          }),
        ).rejects.toThrow(/unidade comercial/);

        expect(prisma.productFiscalData.updateMany).not.toHaveBeenCalled();
      });

      it('cadastro criado nasce com a unidade pedida, não com o padrão', async () => {
        mockEmissor(SIMPLES);
        mockProdutos([{ id: 'p-1', hasFiscal: false }]);

        await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          commercialUnit: 'M2',
        });

        expect(prisma.productFiscalData.createMany).toHaveBeenCalledWith({
          data: [expect.objectContaining({ commercialUnit: 'M2' })],
          skipDuplicates: true,
        });
      });
    });

    it('recusa origem da mercadoria fora de 0-8 e CFOP que não tem 4 dígitos', async () => {
      mockEmissor(REGIME_NORMAL);

      await expect(
        service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsOrigin: '9',
        }),
      ).rejects.toThrow(/origem da mercadoria/);

      await expect(
        service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          cfopInState: '510',
        }),
      ).rejects.toThrow(/4 dígitos/);
    });

    /**
     * Quem corrige só o CST não pode ter o CFOP ou a alíquota ajustados à mão
     * sobrescritos por um padrão.
     */
    it('grava somente os campos informados', async () => {
      mockEmissor(REGIME_NORMAL);
      mockProdutos([{ id: 'p-1', hasFiscal: true }]);

      await service.bulkUpdateTributacao(COMPANY, {
        productIds: ['p-1'],
        icmsCst: '40',
        icmsOrigin: '0',
      });

      expect(prisma.productFiscalData.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { icmsCst: '40', icmsOrigin: '0' } }),
      );
    });

    it('filtra por companyId e ignora ids de fora da empresa', async () => {
      mockEmissor(REGIME_NORMAL);
      prisma.product.findMany
        .mockResolvedValueOnce([{ id: 'p-1' }])
        .mockResolvedValueOnce([]);
      prisma.productFiscalData.count.mockResolvedValue(0);
      prisma.productFiscalData.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.bulkUpdateTributacao(COMPANY, {
        productIds: ['p-1', 'de-outra-empresa'],
        icmsCst: '40',
      });

      expect(result.ignored).toBe(1);
      expect(prisma.product.findMany).toHaveBeenNthCalledWith(1, {
        where: { id: { in: ['p-1', 'de-outra-empresa'] }, companyId: COMPANY },
        select: { id: true },
      });
    });

    it('falha quando nenhum id pertence à empresa', async () => {
      mockEmissor(REGIME_NORMAL);
      prisma.product.findMany.mockResolvedValueOnce([]);

      await expect(
        service.bulkUpdateTributacao(COMPANY, {
          productIds: ['de-outra-empresa'],
          icmsCst: '40',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    /**
     * Produto sem cadastro fiscal não emite nota: o cadastro nasce com os
     * defaults do regime e já com a correção aplicada em cima.
     */
    it('cria cadastro para quem não tem, com os defaults do regime e a correção', async () => {
      mockEmissor(REGIME_NORMAL, {
        defaultNcm: '4911.10.10',
        defaultCfop: '5102',
      });
      mockProdutos([
        { id: 'p-1', hasFiscal: true },
        { id: 'p-2', hasFiscal: false },
      ]);

      await service.bulkUpdateTributacao(COMPANY, {
        productIds: ['p-1', 'p-2'],
        icmsCst: '00',
        icmsRate: 17,
      });

      expect(prisma.productFiscalData.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            productId: 'p-2',
            ncm: '49111010',
            cfopInState: '5102',
            icmsCst: '00',
            icmsRate: 17,
          }),
        ],
        skipDuplicates: true,
      });
    });

    /** Inventar um NCM aqui seria gravar classificação fiscal errada calada. */
    it('não inventa NCM ao criar cadastro quando o emissor não tem padrão', async () => {
      mockEmissor(REGIME_NORMAL);
      mockProdutos([{ id: 'p-1', hasFiscal: false }]);

      await service.bulkUpdateTributacao(COMPANY, {
        productIds: ['p-1'],
        icmsCst: '40',
      });

      expect(prisma.productFiscalData.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ ncm: null, cfopInState: '5101' })],
        skipDuplicates: true,
      });
    });

    describe("filtro 'só os do outro regime'", () => {
      it('no Regime Normal atinge os CSOSN e quem está sem CST', async () => {
        mockEmissor(REGIME_NORMAL);
        mockProdutos([{ id: 'p-1', hasFiscal: true }]);

        await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '40',
          onlyIncompatibleRegime: true,
        });

        const where =
          prisma.productFiscalData.updateMany.mock.calls[0][0].where;
        expect(where.OR).toEqual([
          { icmsCst: { in: expect.arrayContaining(['102', '500', '900']) } },
          { icmsCst: null },
          { icmsCst: '' },
        ]);
        expect(where.OR[0].icmsCst.in).not.toContain('00');
      });

      it('no Simples atinge os CST do Regime Normal', async () => {
        mockEmissor(SIMPLES);
        mockProdutos([{ id: 'p-1', hasFiscal: true }]);

        await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '102',
          onlyIncompatibleRegime: true,
        });

        const where =
          prisma.productFiscalData.updateMany.mock.calls[0][0].where;
        expect(where.OR[0].icmsCst.in).toEqual(
          expect.arrayContaining(['00', '20', '60']),
        );
        expect(where.OR[0].icmsCst.in).not.toContain('102');
      });

      it('explica quando todos já estão com o CST do regime', async () => {
        mockEmissor(REGIME_NORMAL);
        prisma.product.findMany
          .mockResolvedValueOnce([{ id: 'p-1' }])
          .mockResolvedValueOnce([]);
        prisma.productFiscalData.count.mockResolvedValue(0);
        prisma.productFiscalData.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.bulkUpdateTributacao(COMPANY, {
            productIds: ['p-1'],
            icmsCst: '40',
            onlyIncompatibleRegime: true,
          }),
        ).rejects.toThrow(/já estão com um CST do regime/);
      });

      /**
       * A conferência de alíquota precisa respeitar o filtro por regime sem
       * sobrescrever o OR dele — daí o AND explícito.
       */
      it('confere a alíquota dentro do mesmo filtro, sem perder o OR do regime', async () => {
        mockEmissor(REGIME_NORMAL);
        prisma.product.findMany
          .mockResolvedValueOnce([{ id: 'p-1' }])
          .mockResolvedValueOnce([]);
        prisma.productFiscalData.count.mockResolvedValue(0);
        prisma.productFiscalData.updateMany.mockResolvedValue({ count: 1 });

        await service.bulkUpdateTributacao(COMPANY, {
          productIds: ['p-1'],
          icmsCst: '00',
          onlyIncompatibleRegime: true,
        });

        const where = prisma.productFiscalData.count.mock.calls[0][0].where;
        expect(where.AND[0].OR).toBeDefined();
        expect(where.AND[1]).toEqual({ icmsRate: null });
      });
    });

    describe("escopo 'todos os produtos'", () => {
      it('aplica os filtros da listagem com a empresa vinda do token', async () => {
        mockEmissor(REGIME_NORMAL);
        prisma.product.findMany.mockResolvedValue([]);
        prisma.productFiscalData.count.mockResolvedValue(0);
        prisma.productFiscalData.updateMany.mockResolvedValue({ count: 42 });

        const result = await service.bulkUpdateTributacao(COMPANY, {
          scope: 'ALL',
          productIds: ['ignorado'],
          filters: { search: 'placa' },
          icmsCst: '00',
          icmsRate: 17,
        });

        expect(result).toMatchObject({ scope: 'ALL', updated: 42, ignored: 0 });
        // Escopo ALL não resolve IDs: a única busca é a de quem não tem cadastro.
        expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
        const where =
          prisma.productFiscalData.updateMany.mock.calls[0][0].where;
        expect(where.product).toMatchObject({ companyId: COMPANY });
      });

      it('cria cadastros em lotes de 500', async () => {
        mockEmissor(REGIME_NORMAL);
        const semCadastro = Array.from({ length: 1200 }, (_, i) => ({
          id: `p-${i}`,
        }));
        prisma.product.findMany.mockResolvedValue(semCadastro);
        prisma.productFiscalData.count.mockResolvedValue(0);
        prisma.productFiscalData.updateMany.mockResolvedValue({ count: 0 });
        prisma.productFiscalData.createMany
          .mockResolvedValueOnce({ count: 500 })
          .mockResolvedValueOnce({ count: 500 })
          .mockResolvedValueOnce({ count: 200 });

        const result = await service.bulkUpdateTributacao(COMPANY, {
          scope: 'ALL',
          icmsCst: '40',
        });

        expect(prisma.productFiscalData.createMany).toHaveBeenCalledTimes(3);
        expect(result.created).toBe(1200);
      });
    });
  });

  describe('contarAlvosBulkTributacao', () => {
    const COMPANY = 'company-1';

    it('soma quem tem cadastro fiscal e quem ainda não tem, sem escrever', async () => {
      prisma.invoicyConfig.findFirst.mockResolvedValue({ emitCrt: 3 });
      prisma.productFiscalData.count.mockResolvedValue(119);
      prisma.product.count.mockResolvedValue(2);

      const result = await service.contarAlvosBulkTributacao(COMPANY, {
        scope: 'ALL',
        icmsCst: '00',
        onlyIncompatibleRegime: true,
      });

      expect(result).toEqual({
        total: 121,
        comCadastroFiscal: 119,
        semCadastroFiscal: 2,
      });
      expect(prisma.productFiscalData.updateMany).not.toHaveBeenCalled();
      expect(prisma.productFiscalData.createMany).not.toHaveBeenCalled();
    });
  });

  describe('opcoesBulkTributacao', () => {
    const COMPANY = 'company-1';

    it('devolve regime, CSTs do regime e quantos estão com o código do outro', async () => {
      prisma.invoicyConfig.findFirst.mockResolvedValue({ emitCrt: 3 });
      prisma.address.findMany.mockResolvedValue([
        { state: 'sc', type: 'Entrega' },
        { state: 'rs', type: 'Principal' },
      ]);
      prisma.productFiscalData.count.mockResolvedValue(119);
      prisma.product.count.mockResolvedValue(0);
      aliquotaInterna.listar.mockResolvedValue([
        { uf: 'RS', aliquota: 17, origem: 'padrao', revisado: false },
        { uf: 'SC', aliquota: 17, origem: 'padrao', revisado: true },
      ]);

      const result = await service.opcoesBulkTributacao(COMPANY);

      expect(result).toMatchObject({
        emitCrt: 3,
        regime: 'NORMAL',
        // Endereço principal vence a ordem em que os endereços vieram.
        uf: 'RS',
        incompativeis: 119,
      });
      expect(result.cstOptions.map((o) => o.code)).toContain('00');
      expect(result.cstOptions.map((o) => o.code)).not.toContain('102');
    });

    /**
     * Parte dos padrões por UF não foi conferida na legislação estadual: a
     * tela precisa receber `revisado` para poder dizer isso, em vez de
     * apresentar o número como verdade fiscal.
     */
    it('passa adiante a procedência da alíquota sugerida', async () => {
      prisma.invoicyConfig.findFirst.mockResolvedValue({ emitCrt: 3 });
      prisma.address.findMany.mockResolvedValue([
        { state: 'RS', type: 'Principal' },
      ]);
      prisma.productFiscalData.count.mockResolvedValue(0);
      prisma.product.count.mockResolvedValue(0);
      aliquotaInterna.listar.mockResolvedValue([
        { uf: 'RS', aliquota: 17, origem: 'padrao', revisado: false },
      ]);

      const result = await service.opcoesBulkTributacao(COMPANY);

      expect(result.aliquotaInternaSugerida).toEqual({
        uf: 'RS',
        aliquota: 17,
        origem: 'padrao',
        revisado: false,
      });
    });

    it('no Simples oferece os CSOSN', async () => {
      prisma.invoicyConfig.findFirst.mockResolvedValue({ emitCrt: 1 });
      prisma.productFiscalData.count.mockResolvedValue(0);
      prisma.product.count.mockResolvedValue(0);

      const result = await service.opcoesBulkTributacao(COMPANY);

      expect(result.regime).toBe('SIMPLES');
      expect(result.cstOptions.map((o) => o.code)).toContain('102');
      expect(result.uf).toBeNull();
      expect(result.aliquotaInternaSugerida).toBeNull();
    });
  });
});
