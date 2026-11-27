import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'nestjs-prisma';
import { NatureService } from './nature.service';

/**
 * A listagem do Plano de contas monta uma árvore (nível 1 → nível 2 →
 * natureza → subcategoria) e ordena cada ramo pelo código. Código é opcional
 * no banco, e a importação do financeiro criou vários registros sem ele: o
 * `localeCompare` estourava, o catch do service virava 500 e a tela abria
 * vazia — com as abas contando certo, porque vêm de outra consulta. Seis
 * contas ficaram nesse estado (Clapp, Samys, Fenix, Sparta, INOVAMAIS,
 * Quality).
 */
describe('NatureService', () => {
  let service: NatureService;
  let prisma: any;

  const COMPANY = 'company-1';

  const natureza = (over: Record<string, unknown> = {}) => ({
    id: 1,
    companyId: COMPANY,
    code: '01',
    description: 'Vendas',
    level1: '01',
    level2: '02',
    isActive: true,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      nature: { findMany: jest.fn().mockResolvedValue([]) },
      subCategory: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [NatureService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<NatureService>(NatureService);
  });

  describe('findAll', () => {
    it('lista as naturezas agrupadas por nível', async () => {
      prisma.nature.findMany.mockResolvedValue([natureza()]);

      const resultado = await service.findAll({
        companyId: COMPANY,
        page: '1',
        limit: '10',
      } as any);

      const receitas = resultado.data.find((g: any) => g.code === '01');
      const operacional = receitas.level2.find((g: any) => g.code === '02');
      expect(operacional.natures).toHaveLength(1);
      expect(operacional.natures[0].description).toBe('Vendas');
    });

    /** O defeito que deixou seis contas sem a tela. */
    it('não quebra com natureza sem código', async () => {
      prisma.nature.findMany.mockResolvedValue([
        natureza({ id: 2, code: null, description: 'DESPESAS BANCARIAS' }),
        natureza(),
      ]);

      const resultado = await service.findAll({
        companyId: COMPANY,
        page: '1',
        limit: '10',
      } as any);

      const receitas = resultado.data.find((g: any) => g.code === '01');
      const operacional = receitas.level2.find((g: any) => g.code === '02');
      expect(operacional.natures).toHaveLength(2);
      // Sem código vem primeiro, e nada é descartado.
      expect(operacional.natures.map((n: any) => n.code)).toEqual([null, '01']);
    });

    it('não quebra com subcategoria sem código', async () => {
      prisma.nature.findMany.mockResolvedValue([natureza()]);
      prisma.subCategory.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          description: 'Tarifa',
          code: null,
          isActive: true,
          nature: natureza(),
        },
        {
          id: 'sub-2',
          description: 'Juros',
          code: '02',
          isActive: true,
          nature: natureza(),
        },
      ]);

      const resultado = await service.findAll({
        companyId: COMPANY,
        page: '1',
        limit: '10',
      } as any);

      const receitas = resultado.data.find((g: any) => g.code === '01');
      const operacional = receitas.level2.find((g: any) => g.code === '02');
      expect(operacional.natures[0].subCategories).toHaveLength(2);
    });
  });
});
