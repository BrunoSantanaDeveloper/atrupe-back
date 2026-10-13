import { differenceInMonths } from 'date-fns';

/**
 * As contas do patrimônio (módulo 4), sem banco: depreciação, situação,
 * custo mensal dos custos do bem, tempo de atividade e custo por unidade da
 * configuração produtiva. Dinheiro em centavos; percentuais com até duas
 * casas. A base de custos e a precificação leem daqui.
 */

export type AssetStatus =
  | 'DEPRECIATING'
  | 'REVIEW_NEEDED'
  | 'DEPRECIATED'
  | 'INCONSISTENT'
  | 'INACTIVE';

export type AssetInput = {
  active: boolean;
  detailed: boolean;
  acquisitionDate: Date | null;
  acquisitionValue: number;
  usefulLifeMonths: number | null;
  residualPercent: number | null;
  usefulLifeReviewedAt: Date | null;
  monthlyProductivity: number | null;
};

export type CostInput = {
  nature: 'FIXED' | 'MACHINE_VARIABLE' | 'SETUP_VARIABLE';
  unitCost: number;
  yieldAmount: number;
  yieldUnit: 'MONTH' | 'UNIT';
  setupId: string | null;
};

export type SetupInput = {
  id: string;
  timePerUnit: number;
  monthlyProductivity: number;
};

/** Meses completos desde a aquisição; sem data, zero. */
export const elapsedMonthsOf = (acquisitionDate: Date | null, today: Date) =>
  acquisitionDate ? Math.max(0, differenceInMonths(today, acquisitionDate)) : 0;

/**
 * A depreciação linear: residual pelo percentual, mensal pela vida útil e o
 * acumulado até hoje, limitado ao depreciável. Sem vida útil ou residual, a
 * depreciação não é calculada (nula, nunca zero, P-12); o bem inativo não
 * deprecia.
 */
export const depreciationOf = (asset: AssetInput, today: Date) => {
  const residualValue =
    asset.residualPercent === null
      ? null
      : Math.round((asset.acquisitionValue * asset.residualPercent) / 100);
  const depreciableValue =
    residualValue === null
      ? null
      : Math.max(0, asset.acquisitionValue - residualValue);
  const calculable =
    asset.active &&
    !!asset.usefulLifeMonths &&
    asset.usefulLifeMonths > 0 &&
    depreciableValue !== null;
  const monthlyDepreciation = calculable
    ? Math.round(depreciableValue! / asset.usefulLifeMonths!)
    : null;
  const elapsedMonths = elapsedMonthsOf(asset.acquisitionDate, today);
  const depreciatedValue =
    monthlyDepreciation === null || depreciableValue === null
      ? null
      : Math.min(monthlyDepreciation * elapsedMonths, depreciableValue);
  const remainingValue =
    depreciatedValue === null || depreciableValue === null
      ? null
      : depreciableValue - depreciatedValue;
  return {
    residualValue,
    depreciableValue,
    monthlyDepreciation,
    depreciatedValue,
    remainingValue,
    elapsedMonths,
  };
};

/**
 * A situação do bem (P-9, P-26):
 * - inativo;
 * - inconsistente: residual de 100 % ou mais, sem vida útil, detalhado sem
 *   produtividade, ou detalhado sem tempo por unidade num setor que rateia
 *   pelo tempo de atividade;
 * - ao fim da vida útil, em revisão; revista depois do fim, depreciado;
 * - senão, em depreciação.
 */
export const statusOf = (
  asset: AssetInput,
  today: Date,
  context: { sectorByTime: boolean; setups: SetupInput[] },
): AssetStatus => {
  if (!asset.active) return 'INACTIVE';
  const inconsistent =
    (asset.residualPercent !== null && asset.residualPercent >= 100) ||
    !asset.usefulLifeMonths ||
    asset.usefulLifeMonths <= 0 ||
    (asset.detailed && !(productivityOf(asset, context.setups) > 0)) ||
    (asset.detailed &&
      context.sectorByTime &&
      !context.setups.some((setup) => setup.timePerUnit > 0));
  if (inconsistent) return 'INCONSISTENT';
  const elapsed = elapsedMonthsOf(asset.acquisitionDate, today);
  if (elapsed < asset.usefulLifeMonths!) return 'DEPRECIATING';
  const lifeEnd = asset.acquisitionDate
    ? new Date(
        asset.acquisitionDate.getFullYear(),
        asset.acquisitionDate.getMonth() + asset.usefulLifeMonths!,
        asset.acquisitionDate.getDate(),
      )
    : null;
  return asset.usefulLifeReviewedAt &&
    lifeEnd &&
    asset.usefulLifeReviewedAt >= lifeEnd
    ? 'DEPRECIATED'
    : 'REVIEW_NEEDED';
};

/** A produtividade do bem: a soma das configurações, quando há (P-31). */
export const productivityOf = (
  asset: { monthlyProductivity: number | null },
  setups: SetupInput[],
) =>
  setups.length
    ? setups.reduce((sum, setup) => sum + setup.monthlyProductivity, 0)
    : (asset.monthlyProductivity ?? 0);

/**
 * O custo de um custo do bem no mês (P-19, P-32): o fixo diluído no
 * rendimento; o variável pelo rendimento × a produtividade (a do bem, ou a
 * da configuração no variável da configuração).
 */
export const monthlyCostOf = (
  cost: CostInput,
  productivity: { asset: number; setup: (setupId: string) => number },
) => {
  if (!(cost.yieldAmount > 0)) return 0;
  if (cost.yieldUnit === 'MONTH') {
    return Math.round(cost.unitCost / cost.yieldAmount);
  }
  const volume =
    cost.nature === 'SETUP_VARIABLE' && cost.setupId
      ? productivity.setup(cost.setupId)
      : productivity.asset;
  return Math.round((cost.unitCost / cost.yieldAmount) * volume);
};

/** Horas de atividade da configuração no mês (BC-2). */
export const activityHoursOf = (setup: SetupInput) =>
  (setup.timePerUnit * setup.monthlyProductivity) / 60;

/**
 * O custo do equipamento no mês fora o variável da configuração:
 * depreciação + custos fixos + variáveis da máquina.
 */
export const equipmentOwnCostOf = (
  monthlyDepreciation: number | null,
  costs: { nature: CostInput['nature']; monthlyCost: number }[],
) =>
  (monthlyDepreciation ?? 0) +
  costs
    .filter((cost) => cost.nature !== 'SETUP_VARIABLE')
    .reduce((sum, cost) => sum + cost.monthlyCost, 0);

/**
 * O custo por unidade de cada configuração (P-19, §6.3): a parte do custo do
 * equipamento no mês pelo tempo de atividade (sem tempo informado, pela
 * produtividade), dividida pela produtividade da configuração, mais o custo
 * variável dela por unidade. `equipmentMonthlyCost` já vem com a parte do
 * rateio do setor quando a base de custos a calcula.
 */
export const setupUnitCostsOf = (
  equipmentMonthlyCost: number,
  setups: SetupInput[],
  variableUnitCost: (setupId: string) => number,
) => {
  const hours = setups.map(activityHoursOf);
  const totalHours = hours.reduce((sum, value) => sum + value, 0);
  const totalProductivity = setups.reduce(
    (sum, setup) => sum + setup.monthlyProductivity,
    0,
  );
  return new Map(
    setups.map((setup, index) => {
      const share =
        totalHours > 0
          ? hours[index] / totalHours
          : totalProductivity > 0
            ? setup.monthlyProductivity / totalProductivity
            : 0;
      const unitCost =
        setup.monthlyProductivity > 0
          ? Math.round(
              (equipmentMonthlyCost * share) / setup.monthlyProductivity +
                variableUnitCost(setup.id),
            )
          : null;
      return [setup.id, unitCost] as const;
    }),
  );
};
