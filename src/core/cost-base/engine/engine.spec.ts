import { allocationOf, manualFits, toPercentages } from './allocation';
import {
  criterionValueOf,
  defaultCriterionOf,
  sharesOf,
  statsOf,
} from './expenses';
import { laborOf, marginOf, toMinute } from './labor';
import {
  monthOfDate,
  monthsUpTo,
  referenceMonthOf,
  shiftMonth,
} from './months';
import {
  SectorCostItem,
  SectorInput,
  distributionFits,
  sectorCostsOf,
  summaryOf,
} from './sectors';

// Os setores do exemplo do front (cost-base-data.ts), com os itens de cada um
const item = (
  origin: SectorCostItem['origin'],
  value: number,
  name = 'x',
  assetId?: string,
): SectorCostItem => ({
  id: `${name}-${value}`,
  name,
  origin,
  detail: '',
  value,
  assetId,
});

const sector = (
  id: string,
  nature: SectorInput['nature'],
  items: SectorCostItem[],
  distributionPercentage = 0,
): SectorInput => ({
  id,
  name: id,
  nature,
  distributionPercentage,
  allocationCriterion: 'ACQUISITION_VALUE',
  items,
});

const MOCK = (impressaoPercentage = 0) => [
  sector('administracao', 'ADMINISTRATIVE', [
    item('LABOR', 716833),
    item('OTHER', 875099),
    item('DEPRECIATION', 16667),
    item('OTHER', 10500),
  ]),
  sector('comercial', 'ADMINISTRATIVE', [item('LABOR', 480000)]),
  sector(
    'impressao',
    'PRODUCTIVE',
    [
      item('DEPRECIATION', 64167, 'solvente', 'solvente'),
      item('ASSETS', 41667, 'solvente', 'solvente'),
      item('DEPRECIATION', 23333, 'sublimatica', 'sublimatica'),
      item('DEPRECIATION', 11667, 'plotter'),
      item('DEPRECIATION', 35000, 'offset'),
      item('DEPRECIATION', 7583, 'moveis'),
    ],
    impressaoPercentage,
  ),
  sector('producao', 'PRODUCTIVE', [item('LABOR', 405750)]),
  sector('criacao', 'PRODUCTIVE', [item('LABOR', 362250)]),
  sector('cnc', 'PRODUCTIVE', [item('ASSETS', 60500)]),
  sector('marcenaria', 'PRODUCTIVE', []),
];

describe('base de custos: o motor', () => {
  describe('meses (DC-17)', () => {
    it('a referência é o último mês completo, no horário de São Paulo', () => {
      expect(referenceMonthOf(new Date('2026-10-13T15:00:00Z'))).toBe(
        '2026-09',
      );
      // Às 2h UTC de 1º de outubro ainda é 30 de setembro em São Paulo
      expect(referenceMonthOf(new Date('2026-10-01T02:00:00Z'))).toBe(
        '2026-08',
      );
      expect(shiftMonth('2026-01', -1)).toBe('2025-12');
      expect(monthsUpTo('2026-02', 3)).toEqual([
        '2026-02',
        '2026-01',
        '2025-12',
      ]);
      expect(monthOfDate(new Date('2026-08-01T00:00:00Z'))).toBe('2026-08');
    });
  });

  describe('despesas administrativas', () => {
    const months = (values: [string, number][]) => new Map(values);

    it('as médias só existem com histórico; o mês sem lançamento conta zero', () => {
      // Sistemas e assinaturas: três meses de histórico
      const stats = statsOf(
        months([
          ['2026-07', 46000],
          ['2026-08', 47000],
          ['2026-09', 48900],
        ]),
        '2026-07',
        '2026-09',
      );
      expect(stats).toEqual({
        lastMonth: 48900,
        avg3: 47300,
        avg6: null,
        avg12: null,
      });
      expect(defaultCriterionOf(stats)).toBe('AVG_3');

      // IPTU: pago só em março; o último mês é zero, não nulo
      const iptu = statsOf(months([['2026-03', 456000]]), '2025-01', '2026-09');
      expect(iptu.lastMonth).toBe(0);
      expect(iptu.avg12).toBe(38000);
      expect(defaultCriterionOf(iptu)).toBe('AVG_12');
    });

    it('sem lançamento nenhum, tudo nulo e o critério cai no último mês', () => {
      const stats = statsOf(new Map(), null, '2026-09');
      expect(stats).toEqual({
        lastMonth: null,
        avg3: null,
        avg6: null,
        avg12: null,
      });
      expect(defaultCriterionOf(stats)).toBe('LAST_MONTH');
    });

    it('o manual vale o valor informado', () => {
      const stats = {
        lastMonth: 32000,
        avg3: 32000,
        avg6: 31000,
        avg12: 30500,
      };
      expect(criterionValueOf(stats, 'MANUAL', 35000)).toBe(35000);
      expect(criterionValueOf(stats, 'AVG_6', null)).toBe(31000);
    });

    it('o rateio por item lê só os percentuais válidos e positivos', () => {
      expect(
        sharesOf([
          { sectorId: 'a', percentage: 50 },
          { sectorId: 'b', percentage: 0 },
          { sectorId: 3, percentage: 10 },
          null,
        ]),
      ).toEqual([{ sectorId: 'a', percentage: 50 }]);
      expect(sharesOf(null)).toEqual([]);
    });
  });

  describe('por setor, resumo e distribuição', () => {
    it('o custo próprio é a soma dos itens; sem item, nulo (DC-15)', () => {
      const costs = sectorCostsOf(MOCK());
      const byId = new Map(costs.sectors.map((row) => [row.id, row]));
      expect(byId.get('impressao')!.ownCost).toBe(183417);
      expect(byId.get('impressao')!.depreciation).toBe(141750);
      expect(byId.get('impressao')!.labor).toBeNull();
      expect(byId.get('administracao')!.ownCost).toBe(1619099);
      expect(byId.get('marcenaria')!.ownCost).toBeNull();
      expect(byId.get('marcenaria')!.totalCost).toBeNull();
      expect(costs.administrativeCost).toBe(2099099);
      expect(costs.isDistributing).toBe(false);
    });

    it('o produtivo recebe o percentual do total administrativo (contrato)', () => {
      const costs = sectorCostsOf(MOCK(12.5));
      const impressao = costs.sectors.find((row) => row.id === 'impressao')!;
      expect(impressao.receivedCost).toBe(262387);
      expect(impressao.totalCost).toBe(183417 + 262387);
      expect(costs.distributedCost).toBe(262387);
      expect(costs.isDistributing).toBe(true);
    });

    it('o resumo consolida o mesmo cálculo', () => {
      const summary = summaryOf(sectorCostsOf(MOCK()));
      expect(summary.byOrigin).toEqual({
        adminExpenses: 885599,
        labor: 1964833,
        assets: 102167,
        depreciation: 158417,
      });
      expect(summary.administrativeCost).toBe(2099099);
      expect(summary.productiveCost).toBe(183417 + 405750 + 362250 + 60500);
      expect(summary.total).toBe(summary.productiveCost + 2099099);
      expect(summary.bySector[0]).toEqual({
        id: 'administracao',
        name: 'administracao',
        value: 1619099,
      });
    });

    it('a soma da distribuição é conferida pelo valor, com 1 centavo', () => {
      // 33,33 % três vezes de 100,00 dá 99,99: cabe
      expect(distributionFits(10000, [33.33, 33.33, 33.33])).toBe(true);
      expect(distributionFits(10000, [50, 50.01])).toBe(true);
      expect(distributionFits(10000, [50, 50.02])).toBe(false);
      // Sem custo administrativo, pelos percentuais
      expect(distributionFits(0, [60, 40])).toBe(true);
      expect(distributionFits(0, [60, 41])).toBe(false);
    });
  });

  describe('rateio entre os equipamentos (BC-3, BC-3.1)', () => {
    // A Impressão do exemplo: o que não é das duas impressoras detalhadas
    // (plotter, offset e móveis) é o custo a repartir
    const equipment = [
      {
        id: 'sublimatica',
        name: 'Impressora Sublimática',
        acquisitionValue: 4000000,
        activityHours: 164,
        ownCost: 43333,
      },
      {
        id: 'solvente',
        name: 'Impressora Solvente',
        acquisitionValue: 7000000,
        activityHours: (5 * 200 + 8 * 200) / 60,
        ownCost: 105834,
      },
    ];
    const pool = 11667 + 35000 + 7583;

    it('os percentuais fecham 100 com a sobra no maior', () => {
      expect(toPercentages([1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
      expect(toPercentages([0, 0])).toEqual([null, null]);
    });

    it('rateio manual 50/50: Sublimática ≈ 18 % mais barata, Solvente ≈ 13 % mais cara', () => {
      const byTime = allocationOf({
        criterion: 'ACTIVITY_TIME',
        manual: new Map(),
        pool,
        equipment,
      });
      const manual = allocationOf({
        criterion: 'MANUAL',
        manual: new Map([
          ['sublimatica', 50],
          ['solvente', 50],
        ]),
        pool,
        equipment,
      });
      const [subTime, solTime] = byTime.equipment;
      const [subManual, solManual] = manual.equipment;
      expect(subTime.share).toBe(79.1);
      expect(subTime.monthlyCost).toBe(86245);
      expect(solTime.monthlyCost).toBe(117172);
      expect(subManual.monthlyCost).toBe(70458);
      expect(solManual.monthlyCost).toBe(132959);
      expect(subManual.monthlyCost / subTime.monthlyCost - 1).toBeCloseTo(
        -0.183,
        3,
      );
      expect(solManual.monthlyCost / solTime.monthlyCost - 1).toBeCloseTo(
        0.135,
        3,
      );
      // O custo-hora acompanha
      expect(subManual.hourCost).toBe(Math.round(70458 / 164));
      expect(manual.equipment[0].shares).toEqual({
        ACQUISITION_VALUE: 36.36,
        ACTIVITY_TIME: 79.1,
        MANUAL: 50,
      });
    });

    it('sem tempo informado, o tempo de atividade cai no valor de aquisição (ORG-33)', () => {
      const noTime = equipment.map((row) => ({ ...row, activityHours: 0 }));
      const result = allocationOf({
        criterion: 'ACTIVITY_TIME',
        manual: new Map(),
        pool,
        equipment: noTime,
      });
      expect(result.equipment.map((row) => row.share)).toEqual([36.36, 63.64]);
      expect(result.missingTime).toEqual([
        'Impressora Sublimática',
        'Impressora Solvente',
      ]);
      expect(result.equipment[0].hourCost).toBeNull();
    });

    it('no manual, o bem que entrou depois fica com zero', () => {
      const result = allocationOf({
        criterion: 'MANUAL',
        manual: new Map([['sublimatica', 100]]),
        pool,
        equipment,
      });
      expect(result.equipment.map((row) => row.share)).toEqual([100, 0]);
    });

    it('o manual fecha 100 % pelo valor, com 1 centavo', () => {
      expect(manualFits(pool, [50, 50])).toBe(true);
      expect(manualFits(pool, [33.333, 66.667])).toBe(true);
      expect(manualFits(pool, [50, 49])).toBe(false);
      expect(manualFits(0, [40, 60])).toBe(true);
      expect(manualFits(0, [40, 59])).toBe(false);
    });
  });

  describe('mão de obra (F-11)', () => {
    it('custo-hora pelo custo do setor e a soma das horas', () => {
      // Produção do exemplo: 4.057,50 em 246 horas
      expect(
        laborOf({
          totalCost: 405750,
          hours: [100, 146],
          salePrice: 6000,
          charges: 0,
        }),
      ).toEqual({
        distributedCost: 405750,
        hours: 246,
        costPerHour: 1649,
        salePrice: 6000,
        margin: 72.5,
      });
    });

    it('sem horas, sem custo-hora nem margem', () => {
      const result = laborOf({
        totalCost: 405750,
        hours: [0],
        salePrice: 6000,
        charges: 0,
      });
      expect([result.hours, result.costPerHour, result.margin]).toEqual([
        null,
        null,
        null,
      ]);
    });

    it('a margem desconta os encargos da precificação (PR-3)', () => {
      // 100,00 de preço, 60,00 de custo e 15 % de encargos: 25 %
      expect(marginOf(10000, 6000, 150)).toBe(25);
      expect(marginOf(null, 6000, 0)).toBeNull();
      expect(toMinute(1.2345)).toBe(74 / 60);
    });
  });
});
