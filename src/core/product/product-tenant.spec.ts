import { NotFoundException } from '@nestjs/common';
import { ProductService } from './product.service';

describe('ProductService: cadastros da empresa', () => {
  let prisma: any;
  let service: ProductService;

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      category: { count: jest.fn(async ({ where }) => where.id.in.length) },
      companySector: {
        count: jest.fn(async ({ where }) => where.id.in.length),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // A situação da composição padrão no cadastro (18/11/2026)
      productAssembly: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    service = new ProductService(prisma, {} as any);
  });

  it('as etapas do produto só oferecem setores da empresa dele', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p-1',
      companyId: 'c-1',
      productionStages: [],
      items: [],
    });

    await service.findOne('p-1');
    expect(prisma.companySector.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c-1', isProductionStage: true, isSystem: false },
      }),
    );
  });

  it('grupo de outra empresa é recusado antes de criar', async () => {
    prisma.category.count.mockResolvedValueOnce(0);

    await expect(
      service.create({
        companyId: 'c-1',
        code: 'P1',
        categoryId: 'grupo-de-outra',
      } as any),
    ).rejects.toThrow(new NotFoundException('Grupo não encontrado.'));
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('setor ou etapa de outra empresa é recusado na edição', async () => {
    prisma.product.findUnique.mockResolvedValueOnce({ companyId: 'c-1' });
    prisma.companySector.count.mockResolvedValueOnce(1);

    await expect(
      service.update('p-1', {
        sectorId: 'setor-1',
        productionStages: [{ id: 'setor-de-outra' }],
      } as any),
    ).rejects.toThrow(new NotFoundException('Setor não encontrado.'));
    expect(prisma.companySector.count).toHaveBeenCalledWith({
      where: { id: { in: ['setor-1', 'setor-de-outra'] }, companyId: 'c-1' },
    });
  });

  it('o setor e as etapas que o produto já tinha não são conferidos de novo (Lista Lite 19/11, 5)', async () => {
    prisma.product.findUnique.mockResolvedValueOnce({
      companyId: 'c-1',
      categoryId: 'grupo-1',
      sectorId: 'setor-antigo',
      productionStages: [{ id: 'etapa-antiga', isActive: true }],
    });
    prisma.companySector.count.mockResolvedValueOnce(1);

    // Para depois da conferência: o resto da edição não interessa aqui
    prisma.product.findUnique.mockResolvedValueOnce(null);
    await service
      .update('p-1', {
        categoryId: 'grupo-1',
        sectorId: 'setor-antigo',
        productionStages: [{ id: 'etapa-antiga' }, { id: 'etapa-nova' }],
      } as any)
      .catch(() => undefined);
    expect(prisma.companySector.count).toHaveBeenCalledWith({
      where: { id: { in: ['etapa-nova'] }, companyId: 'c-1' },
    });
  });
});
