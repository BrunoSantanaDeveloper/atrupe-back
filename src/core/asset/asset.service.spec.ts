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
      assetReading: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }) => ({
          ...data,
          id: 'r-novo',
          createdAt: new Date('2026-10-20T15:00:00Z'),
        })),
        delete: jest.fn(),
      },
      employee: {
        findFirst: jest.fn().mockResolvedValue({ name: 'Ana', user: null }),
      },
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

  describe('leituras do contador', () => {
    const reading = (date: string, value: number) => ({
      id: `r-${date}`,
      date: new Date(`${date}T00:00:00Z`),
      value,
      createdById: 'u0',
      createdByName: 'Bia',
      createdAt: new Date(`${date}T12:00:00Z`),
    });
    const user = { userId: 'u1', companyId: 'c1' };

    it('o contador não volta: nem abaixo da leitura anterior, nem acima da posterior', async () => {
      prisma.assetReading.findFirst.mockImplementation(async ({ where }) =>
        where.date.lt
          ? reading('2026-10-01', 1000)
          : reading('2026-10-15', 2000.5),
      );
      await expect(
        service.addReading('c1', user, 'a-1', {
          date: '2026-10-10',
          value: 999,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'A leitura não pode voltar: em 01/10/2026 o contador marcava 1.000 m²',
        ),
      );
      await expect(
        service.addReading('c1', user, 'a-1', {
          date: '2026-10-10',
          value: 2001,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'A leitura não pode voltar: em 15/10/2026 o contador marcava 2.000,5 m²',
        ),
      );
      expect(prisma.assetReading.create).not.toHaveBeenCalled();

      const saved = await service.addReading('c1', user, 'a-1', {
        date: '2026-10-10',
        value: 1500,
      });
      expect(prisma.assetReading.create).toHaveBeenCalledWith({
        data: {
          companyId: 'c1',
          assetId: 'a-1',
          date: new Date('2026-10-10T00:00:00Z'),
          value: 1500,
          createdById: 'u1',
          createdByName: 'Ana',
        },
      });
      expect(saved).toEqual(
        expect.objectContaining({
          date: '2026-10-10',
          value: 1500,
          createdByName: 'Ana',
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'ASSET_READING', action: 'CREATE' }),
      );
    });

    it('dia que ainda não chegou e bem de outra empresa são recusados', async () => {
      await expect(
        service.addReading('c1', user, 'a-1', {
          date: '2999-01-01',
          value: 10,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'A leitura não pode ser de um dia que ainda não chegou',
        ),
      );
      await expect(
        service.addReading('c2', user, 'a-1', {
          date: '2026-10-10',
          value: 10,
        }),
      ).rejects.toThrow(new NotFoundException('Patrimônio não encontrado'));
      await expect(service.readings('c2', 'a-1', {})).rejects.toThrow(
        new NotFoundException('Patrimônio não encontrado'),
      );
    });

    it('a lista sai da mais recente para a mais antiga, com a unidade do bem', async () => {
      prisma.assetReading.count.mockResolvedValue(2);
      prisma.assetReading.findMany.mockResolvedValue([
        reading('2026-10-15', 2000),
        reading('2026-10-01', 1000),
      ]);
      const res = await service.readings('c1', 'a-1', { limit: 500 });
      expect(prisma.assetReading.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assetId: 'a-1', companyId: 'c1' },
          orderBy: [{ date: 'desc' }, { value: 'desc' }, { createdAt: 'desc' }],
          // O teto da página (SEG-2)
          take: 100,
        }),
      );
      expect(res).toEqual(
        expect.objectContaining({ unit: 'M2', page: 1, lastPage: 1, total: 2 }),
      );
      expect(res.data.map((row) => [row.date, row.value])).toEqual([
        ['2026-10-15', 2000],
        ['2026-10-01', 1000],
      ]);
    });

    it('apagar: só a leitura do bem da empresa', async () => {
      await expect(
        service.removeReading('c1', 'u1', 'a-1', 'r-9'),
      ).rejects.toThrow(new NotFoundException('Leitura não encontrada'));
      expect(prisma.assetReading.findFirst).toHaveBeenCalledWith({
        where: { id: 'r-9', assetId: 'a-1', companyId: 'c1' },
      });
      prisma.assetReading.findFirst.mockResolvedValue(
        reading('2026-10-01', 1000),
      );
      await service.removeReading('c1', 'u1', 'a-1', 'r-2026-10-01');
      expect(prisma.assetReading.delete).toHaveBeenCalledWith({
        where: { id: 'r-2026-10-01' },
      });
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
