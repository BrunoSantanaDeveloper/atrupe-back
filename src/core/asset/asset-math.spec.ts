import {
  activityHoursOf,
  depreciationOf,
  equipmentOwnCostOf,
  monthlyCostOf,
  productivityOf,
  setupUnitCostsOf,
  statusOf,
} from './asset-math';

/** As contas do patrimônio com os números do contrato (módulo 4). */
describe('asset-math', () => {
  const today = new Date('2026-09-30T12:00:00Z');
  // Impressora Sublimática do contrato: R$ 40.000,00, 120 meses, 30 %,
  // comprada em 27/05/2022 (52 meses completos até 30/09/2026)
  const sublimatica = {
    active: true,
    detailed: true,
    acquisitionDate: new Date('2022-05-27T00:00:00Z'),
    acquisitionValue: 4_000_000,
    usefulLifeMonths: 120,
    residualPercent: 30,
    usefulLifeReviewedAt: null,
    monthlyProductivity: 164,
  };

  it('depreciação linear como no contrato', () => {
    expect(depreciationOf(sublimatica, today)).toEqual({
      residualValue: 1_200_000,
      depreciableValue: 2_800_000,
      monthlyDepreciation: 23_333,
      depreciatedValue: 1_213_316,
      remainingValue: 1_586_684,
      elapsedMonths: 52,
    });
  });

  it('sem vida útil ou residual a depreciação não é calculada (nula, nunca zero)', () => {
    expect(
      depreciationOf({ ...sublimatica, usefulLifeMonths: null }, today)
        .monthlyDepreciation,
    ).toBeNull();
    expect(
      depreciationOf({ ...sublimatica, residualPercent: null }, today)
        .monthlyDepreciation,
    ).toBeNull();
    // Inativo não deprecia
    expect(
      depreciationOf({ ...sublimatica, active: false }, today)
        .monthlyDepreciation,
    ).toBeNull();
  });

  it('o acumulado para no depreciável', () => {
    const old = { ...sublimatica, acquisitionDate: new Date('2000-01-01') };
    const result = depreciationOf(old, today);
    expect(result.depreciatedValue).toBe(2_800_000);
    expect(result.remainingValue).toBe(0);
  });

  it('a situação do bem', () => {
    const setups = [{ id: 's1', timePerUnit: 60, monthlyProductivity: 164 }];
    const context = { sectorByTime: false, setups };
    expect(statusOf(sublimatica, today, context)).toBe('DEPRECIATING');
    expect(statusOf({ ...sublimatica, active: false }, today, context)).toBe(
      'INACTIVE',
    );
    expect(
      statusOf({ ...sublimatica, residualPercent: 100 }, today, context),
    ).toBe('INCONSISTENT');
    // Detalhado sem tempo por unidade, num setor que rateia pelo tempo
    expect(
      statusOf(sublimatica, today, {
        sectorByTime: true,
        setups: [{ id: 's1', timePerUnit: 0, monthlyProductivity: 164 }],
      }),
    ).toBe('INCONSISTENT');
    // Ao fim da vida útil, em revisão; revista depois do fim, depreciado
    const ended = { ...sublimatica, usefulLifeMonths: 40 };
    expect(statusOf(ended, today, context)).toBe('REVIEW_NEEDED');
    expect(
      statusOf({ ...ended, usefulLifeReviewedAt: today }, today, context),
    ).toBe('DEPRECIATED');
  });

  it('custo do bem no mês: fixo pelo rendimento, variável pela produtividade', () => {
    const productivity = { asset: 164, setup: () => 100 };
    // Cabeça de impressão do contrato: R$ 4.800,00 a cada 24 meses
    expect(
      monthlyCostOf(
        {
          nature: 'FIXED',
          unitCost: 480_000,
          yieldAmount: 24,
          yieldUnit: 'MONTH',
          setupId: null,
        },
        productivity,
      ),
    ).toBe(20_000);
    // R$ 1,00 a cada 2 m² × 164 m²
    expect(
      monthlyCostOf(
        {
          nature: 'MACHINE_VARIABLE',
          unitCost: 100,
          yieldAmount: 2,
          yieldUnit: 'UNIT',
          setupId: null,
        },
        productivity,
      ),
    ).toBe(8_200);
  });

  it('tempo de atividade e custo por unidade da configuração', () => {
    const std = { id: 's1', timePerUnit: 60, monthlyProductivity: 164 };
    const fast = { id: 's2', timePerUnit: 30, monthlyProductivity: 100 };
    expect(activityHoursOf(std)).toBe(164);
    expect(productivityOf({ monthlyProductivity: 1 }, [std, fast])).toBe(264);
    const own = equipmentOwnCostOf(23_333, [
      { nature: 'FIXED', monthlyCost: 20_000 },
      { nature: 'SETUP_VARIABLE', monthlyCost: 999 },
    ]);
    expect(own).toBe(43_333);
    // 164 h e 50 h: a std leva 76,6 % do mês
    const costs = setupUnitCostsOf(own, [std, fast], (id) =>
      id === 's2' ? 10 : 0,
    );
    expect(costs.get('s1')).toBe(Math.round((43_333 * (164 / 214)) / 164));
    expect(costs.get('s2')).toBe(Math.round((43_333 * (50 / 214)) / 100 + 10));
  });
});
