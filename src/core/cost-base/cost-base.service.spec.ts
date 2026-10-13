import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CostBaseService } from './cost-base.service';

// O retrato que as escritas leem, montado à mão: um setor administrativo, a
// Impressão (produtiva, com duas impressoras detalhadas) e a Produção sem
// colaborador
const snapshot = () => {
  const sectors = [
    {
      id: 'adm',
      name: 'Administração',
      nature: 'ADMINISTRATIVE',
      distributionPercentage: 0,
      allocationCriterion: 'ACQUISITION_VALUE',
      allocationPreviousCriterion: null,
    },
    {
      id: 'imp',
      name: 'Impressão',
      nature: 'PRODUCTIVE',
      distributionPercentage: 10,
      allocationCriterion: 'ACTIVITY_TIME',
      allocationPreviousCriterion: null,
    },
    {
      id: 'pro',
      name: 'Produção',
      nature: 'PRODUCTIVE',
      distributionPercentage: 0,
      allocationCriterion: 'ACQUISITION_VALUE',
      allocationPreviousCriterion: null,
    },
  ];
  return {
    referenceMonth: '2026-09',
    sectorById: new Map(sectors.map((sector) => [sector.id, sector])),
    assets: [],
    expenses: {
      referenceValue: 100000,
      allocatedValue: 0,
      accounts: [
        {
          id: 'aluguel',
          name: 'Aluguel',
          chartAccount: '02.01.01.02',
          lastMonth: 100000,
          avg3: 100000,
          avg6: null,
          avg12: null,
          criterion: 'AVG_3',
          manualValue: null,
          referenceValue: 100000,
          allocations: [],
          allocatedValue: 0,
          remainder: 100000,
        },
      ],
    },
    costs: {
      administrativeCost: 100000,
      distributedCost: 10000,
      isDistributing: true,
      sectors: sectors.map((sector) => ({
        ...sector,
        percentage: sector.distributionPercentage,
        ownCost: sector.id === 'adm' ? 100000 : null,
        items: [],
      })),
    },
    allocations: [
      {
        sectorId: 'imp',
        sectorName: 'Impressão',
        criterion: 'ACTIVITY_TIME',
        previousCriterion: null,
        allocationOutdated: false,
        pool: 54250,
        equipment: [
          {
            id: 'sub',
            name: 'Impressora Sublimática',
            share: 79.1,
            poolShare: 0,
          },
          { id: 'sol', name: 'Impressora Solvente', share: 20.9, poolShare: 0 },
        ],
        missingTime: [],
      },
    ],
    labor: [
      {
        id: 'imp',
        name: 'Impressão',
        collaborators: [
          { id: 'joao', name: 'João', role: 'Impressor', hours: 0 },
        ],
      },
      { id: 'pro', name: 'Produção', collaborators: [] },
    ],
  };
};

describe('CostBaseService: as escritas', () => {
  let prisma: any;
  let audit: any;
  let service: CostBaseService;

  beforeEach(() => {
    prisma = {
      costBaseExpense: { upsert: jest.fn() },
      companySector: { update: jest.fn() },
      employeeWorkload: { upsert: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    audit = { record: jest.fn() };
    service = new CostBaseService(
      prisma,
      { load: jest.fn(async () => snapshot()) } as any,
      audit,
    );
  });

  const refuses = async (promise: Promise<unknown>, message: string) =>
    expect(promise).rejects.toThrow(new BadRequestException(message));

  describe('critério da conta', () => {
    it('conta de fora responde 404', async () => {
      await expect(
        service.updateAdminExpense('c', null, 'outra', { criterion: 'AVG_3' }),
      ).rejects.toThrow(new NotFoundException('Conta não encontrada'));
    });

    it('o manual pede o valor; a média sem histórico é recusada', async () => {
      await refuses(
        service.updateAdminExpense('c', null, 'aluguel', {
          criterion: 'MANUAL',
        }),
        'Informe o valor mensal desta conta',
      );
      await refuses(
        service.updateAdminExpense('c', null, 'aluguel', {
          criterion: 'AVG_6',
        }),
        'Esta conta ainda não tem histórico para este critério',
      );
      expect(prisma.costBaseExpense.upsert).not.toHaveBeenCalled();
    });

    it('fora do manual o valor é gravado nulo, com histórico', async () => {
      await service.updateAdminExpense('c', 'u', 'aluguel', {
        criterion: 'LAST_MONTH',
        manualValue: 5000,
      });
      expect(prisma.costBaseExpense.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { criterion: 'LAST_MONTH', manualValue: null },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'COST_BASE_EXPENSE',
          entityId: 'aluguel',
        }),
      );
    });
  });

  describe('rateio por item (BC-8)', () => {
    it('só setor produtivo; não passa de 100 % pelo valor', async () => {
      await refuses(
        service.updateExpenseAllocation('c', null, 'aluguel', {
          allocations: [{ sectorId: 'adm', percentage: 10 }],
        }),
        'Só setor produtivo recebe rateio por item',
      );
      await refuses(
        service.updateExpenseAllocation('c', null, 'aluguel', {
          allocations: [
            { sectorId: 'imp', percentage: 60 },
            { sectorId: 'pro', percentage: 40.01 },
          ],
        }),
        'O rateio não pode passar de 100% do custo de referência.',
      );
    });
  });

  describe('distribuição', () => {
    it('administrativo recusado; soma acima de 100 % recusada', async () => {
      await refuses(
        service.updateDistribution('c', null, {
          percentages: [{ id: 'adm', percentage: 10 }],
        }),
        'Só setor produtivo recebe distribuição',
      );
      await refuses(
        service.updateDistribution('c', null, {
          percentages: [
            { id: 'imp', percentage: 60 },
            { id: 'pro', percentage: 41 },
          ],
        }),
        'A soma dos setores produtivos não pode passar de 100%.',
      );
    });

    it('o produtivo que não veio fica com zero', async () => {
      await service.updateDistribution('c', 'u', {
        percentages: [{ id: 'pro', percentage: 25 }],
      });
      expect(prisma.companySector.update).toHaveBeenCalledWith({
        where: { id: 'imp' },
        data: { distributionPercentage: 0 },
      });
      expect(prisma.companySector.update).toHaveBeenCalledWith({
        where: { id: 'pro' },
        data: { distributionPercentage: 25 },
      });
    });
  });

  describe('rateio entre os equipamentos', () => {
    const manual = (percentages: { assetId: string; percentage: number }[]) =>
      service.updateSectorAllocation('c', 'u', 'imp', {
        criterion: 'MANUAL',
        percentages,
      });

    it('setor de fora, administrativo e sem equipamento', async () => {
      await expect(
        service.updateSectorAllocation('c', null, 'x', { criterion: 'MANUAL' }),
      ).rejects.toThrow(new NotFoundException('Setor não encontrado'));
      await refuses(
        service.updateSectorAllocation('c', null, 'adm', {
          criterion: 'MANUAL',
        }),
        'Só setor produtivo tem rateio entre equipamentos',
      );
      await refuses(
        service.updateSectorAllocation('c', null, 'pro', {
          criterion: 'MANUAL',
        }),
        'Este setor não tem equipamento detalhado para ratear',
      );
    });

    it('no manual, um percentual por equipamento, na faixa, fechando 100 %', async () => {
      await refuses(
        manual([{ assetId: 'sub', percentage: 100 }]),
        'Informe o percentual de Impressora Solvente',
      );
      await refuses(
        manual([
          { assetId: 'sub', percentage: 120 },
          { assetId: 'sol', percentage: -20 },
        ]),
        'O percentual de Impressora Sublimática precisa ficar entre 0 e 100%',
      );
      await refuses(
        manual([
          { assetId: 'sub', percentage: 50 },
          { assetId: 'sol', percentage: 49 },
        ]),
        'A soma dos equipamentos precisa fechar 100%',
      );
      await refuses(
        manual([
          { assetId: 'sub', percentage: 50 },
          { assetId: 'sol', percentage: 50 },
          { assetId: 'outro', percentage: 0 },
        ]),
        'Equipamento fora do rateio deste setor',
      );
    });

    it('entrar no manual guarda o critério automático de onde ele nasceu', async () => {
      await manual([
        { assetId: 'sub', percentage: 50 },
        { assetId: 'sol', percentage: 50 },
      ]);
      expect(prisma.companySector.update).toHaveBeenCalledWith({
        where: { id: 'imp' },
        data: expect.objectContaining({
          allocationCriterion: 'MANUAL',
          allocationPreviousCriterion: 'ACTIVITY_TIME',
          allocationOutdated: false,
        }),
      });
    });
  });

  describe('mão de obra', () => {
    it('setor sem colaborador; colaborador de outro setor', async () => {
      await refuses(
        service.updateLaborHours('c', null, 'pro', { hours: [] }),
        'Setor sem colaboradores',
      );
      await refuses(
        service.updateLaborHours('c', null, 'imp', {
          hours: [{ id: 'maria', hours: 10 }],
        }),
        'Colaborador não encontrado neste setor',
      );
    });

    it('as horas são arredondadas ao minuto', async () => {
      await service.updateLaborHours('c', 'u', 'imp', {
        hours: [{ id: 'joao', hours: 1.2345 }],
      });
      expect(prisma.employeeWorkload.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { sectorId: 'imp', hours: 74 / 60 },
        }),
      );
    });
  });
});
