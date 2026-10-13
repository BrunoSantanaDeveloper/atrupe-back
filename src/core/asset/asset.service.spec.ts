import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssetService } from './asset.service';

/**
 * Patrimônios: a empresa da sessão só enxerga e altera os seus; o cadastro
 * rápido nasce com 60 meses e 30 %; a venda calcula o restante pela
 * depreciação acumulada até a data (P-25) e lança a receita.
 */
describe('AssetService', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'a-1',
    companyId: 'c1',
    name: 'Impressora Sublimática',
    imageUrl: null,
    kind: 'MACHINES',
    sectorId: 's-1',
    sector: {
      id: 's-1',
      name: 'Impressão',
      allocationCriterion: 'ACQUISITION_VALUE',
    },
    groupId: null,
    group: null,
    detailed: true,
    unit: 'M2',
    monthlyProductivity: 164,
    acquisitionDate: new Date('2022-05-27T00:00:00Z'),
    acquisitionValue: 4_000_000,
    usefulLifeMonths: 120,
    residualPercent: 30,
    usefulLifeReviewedAt: null,
    active: true,
    inactivatedAt: null,
    inactiveReason: null,
    soldAt: null,
    saleValue: null,
    saleResult: null,
    saleReceivableId: null,
    costs: [],
    setups: [],
    ...overrides,
  });

  let prisma: any;
  let audit: { record: jest.Mock };
  let service: AssetService;

  beforeEach(() => {
    const tx = {
      receivable: { create: jest.fn().mockResolvedValue({ id: 'r-1' }) },
      receivableInstallment: { create: jest.fn() },
      asset: { update: jest.fn() },
    };
    prisma = {
      asset: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === 'a-1' && where.companyId === 'c1' ? row() : null,
        ),
        create: jest.fn(async ({ data }) => row({ ...data, id: 'a-novo' })),
      },
      companySector: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === 's-1' && where.companyId === 'c1' ? { id: 's-1' } : null,
        ),
        updateMany: jest.fn(),
      },
      subCategory: { findFirst: jest.fn() },
      bankAccount: { findFirst: jest.fn() },
      assemblyLineOption: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn) => fn(tx)),
      tx,
    };
    audit = { record: jest.fn() };
    service = new AssetService(prisma, audit as any);
  });

  it('bem de outra empresa responde como inexistente', async () => {
    await expect(service.detail('c2', 'a-1', true)).rejects.toThrow(
      new NotFoundException('Patrimônio não encontrado'),
    );
  });

  it('cadastro rápido: setor da empresa, unidade no detalhado, 60 meses e 30 %', async () => {
    const dto: any = {
      name: 'Impressora UV',
      kind: 'MACHINES',
      sectorId: 's-1',
      detailed: true,
      unit: 'M2',
      acquisitionValue: 6_000_000,
    };
    await expect(
      service.create('c1', 'u1', { ...dto, sectorId: 's-9' }),
    ).rejects.toThrow(new NotFoundException('Setor não encontrado'));
    await expect(
      service.create('c1', 'u1', { ...dto, unit: undefined }),
    ).rejects.toThrow(
      new BadRequestException('Informe a unidade do bem detalhado'),
    );
    await expect(
      service.create('c1', 'u1', {
        ...dto,
        imageUrl: 'data:image/png;base64,AAA',
      }),
    ).rejects.toThrow(
      new BadRequestException('Envie a foto pelo upload de arquivos'),
    );

    await service.create('c1', 'u1', dto);
    expect(prisma.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'c1',
          usefulLifeMonths: 60,
          residualPercent: 30,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ASSET',
        action: 'CREATE',
        userId: 'u1',
      }),
    );
  });

  it('venda: restante pela depreciação acumulada até a data e receita lançada', async () => {
    prisma.subCategory.findFirst.mockResolvedValue({
      id: 'conta-receita',
      natureId: 'n-1',
      nature: { level1: '01' },
    });
    const res = await service.sell('c1', 'u1', 'a-1', {
      value: 1_500_000,
      date: '2026-09-30',
      financialNatureId: 'conta-receita',
    });
    // 4.000.000 − 23.333 × 52 meses
    expect(res).toEqual({
      received: 1_500_000,
      remaining: 2_786_684,
      result: -1_286_684,
      financialEntryId: 'r-1',
    });
    expect(prisma.tx.receivable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'c1',
        totalAmount: 1_500_000,
        subCategoryId: 'conta-receita',
      }),
    });
    expect(prisma.tx.asset.update).toHaveBeenCalledWith({
      where: { id: 'a-1' },
      data: expect.objectContaining({ active: false, inactiveReason: 'Venda' }),
    });
  });

  it('venda pede conta de receita', async () => {
    prisma.subCategory.findFirst.mockResolvedValue({
      id: 'conta-despesa',
      natureId: 'n-2',
      nature: { level1: '02' },
    });
    await expect(
      service.sell('c1', 'u1', 'a-1', {
        value: 100,
        date: '2026-09-30',
        financialNatureId: 'conta-despesa',
      }),
    ).rejects.toThrow('Escolha uma conta de receita do plano de contas');
  });
});
