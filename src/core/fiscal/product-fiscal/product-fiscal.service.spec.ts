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
      product: { findMany: jest.fn(), findUnique: jest.fn() },
      productFiscalData: {
        updateMany: jest.fn(),
        createMany: jest.fn(),
        upsert: jest.fn(),
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

    function mockProducts(products: { id: string; hasFiscal: boolean }[]) {
      prisma.product.findMany.mockResolvedValue(
        products.map((p) => ({
          id: p.id,
          fiscalData: p.hasFiscal ? { id: `fd-${p.id}` } : null,
        })),
      );
      prisma.productFiscalData.updateMany.mockResolvedValue({
        count: products.filter((p) => p.hasFiscal).length,
      });
      prisma.productFiscalData.createMany.mockResolvedValue({
        count: products.filter((p) => !p.hasFiscal).length,
      });
    }

    it('rejeita NCM inválido antes de tocar o banco', async () => {
      await expect(
        service.bulkUpdateNcm(COMPANY, ['p-1'], '123'),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it('rejeita o NCM genérico 00000000', async () => {
      await expect(
        service.bulkUpdateNcm(COMPANY, ['p-1'], '00000000'),
      ).rejects.toThrow(BadRequestException);
    });

    it('normaliza NCM com máscara antes de gravar', async () => {
      mockProducts([{ id: 'p-1', hasFiscal: true }]);

      const result = await service.bulkUpdateNcm(
        COMPANY,
        ['p-1'],
        '4911.10.10',
      );

      expect(result.ncm).toBe('49111010');
      expect(prisma.productFiscalData.updateMany).toHaveBeenCalledWith({
        where: { productId: { in: ['p-1'] } },
        data: { ncm: '49111010' },
      });
    });

    it('filtra por companyId e ignora ids de fora da empresa', async () => {
      mockProducts([{ id: 'p-1', hasFiscal: true }]);

      const result = await service.bulkUpdateNcm(
        COMPANY,
        ['p-1', 'p-de-outra-empresa', 'p-inexistente'],
        '49111010',
      );

      expect(prisma.product.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['p-1', 'p-de-outra-empresa', 'p-inexistente'] },
          companyId: COMPANY,
        },
        select: { id: true, fiscalData: { select: { id: true } } },
      });
      expect(result.ignored).toBe(2);
    });

    it('atualiza quem tem cadastro fiscal e cria para quem não tem', async () => {
      mockProducts([
        { id: 'p-1', hasFiscal: true },
        { id: 'p-2', hasFiscal: false },
        { id: 'p-3', hasFiscal: false },
      ]);

      const result = await service.bulkUpdateNcm(
        COMPANY,
        ['p-1', 'p-2', 'p-3'],
        '49111010',
      );

      expect(prisma.productFiscalData.updateMany).toHaveBeenCalledWith({
        where: { productId: { in: ['p-1'] } },
        data: { ncm: '49111010' },
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
        updated: 1,
        created: 2,
        ignored: 0,
      });
    });

    it('só altera o ncm de quem já tem cadastro, preservando o resto', async () => {
      mockProducts([{ id: 'p-1', hasFiscal: true }]);

      await service.bulkUpdateNcm(COMPANY, ['p-1'], '49111010');

      const updateArgs = prisma.productFiscalData.updateMany.mock.calls[0][0];
      expect(Object.keys(updateArgs.data)).toEqual(['ncm']);
    });

    it('usa o CFOP padrão do emissor ao criar cadastros', async () => {
      prisma.invoicyConfig.findFirst.mockResolvedValue({
        defaultNcm: '11111111',
        defaultCfop: '5102',
      });
      mockProducts([{ id: 'p-1', hasFiscal: false }]);

      await service.bulkUpdateNcm(COMPANY, ['p-1'], '49111010');

      const createArgs = prisma.productFiscalData.createMany.mock.calls[0][0];
      // O NCM vem do que o usuário escolheu, não do default do emissor
      expect(createArgs.data[0].ncm).toBe('49111010');
      expect(createArgs.data[0].cfopInState).toBe('5102');
    });

    it('falha quando nenhum id pertence à empresa', async () => {
      prisma.product.findMany.mockResolvedValue([]);

      await expect(
        service.bulkUpdateNcm(COMPANY, ['p-de-outra-empresa'], '49111010'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
