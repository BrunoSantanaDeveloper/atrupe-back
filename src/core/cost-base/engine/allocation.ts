import { SectorAllocationCriterion } from '@prisma/client';

/**
 * O rateio do custo do setor entre os seus equipamentos detalhados (BC-3,
 * BC-3.1, BC-4). O que o setor custa além dos próprios equipamentos (bens
 * simplificados, folha, despesas rateadas e o administrativo recebido) é
 * repartido pelo valor de aquisição, pelo tempo de atividade ou à mão. É o
 * custo do equipamento que a precificação e a linha de máquina da
 * composição leem (SEG-1).
 */

type Criterion = SectorAllocationCriterion;
type Automatic = Exclude<Criterion, 'MANUAL'>;

export type EquipmentInput = {
  id: string;
  name: string;
  acquisitionValue: number;
  // Horas de atividade no mês: Σ tempo por unidade × produtividade (BC-2)
  activityHours: number;
  // Depreciação e custos do próprio bem no mês
  ownCost: number;
};

/**
 * Percentuais com duas casas que fecham 100: a sobra do arredondamento vai
 * para o maior. Sem peso nenhum, nulos.
 */
export const toPercentages = (weights: number[]): (number | null)[] => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return weights.map(() => null);
  const shares = weights.map(
    (weight) => Math.round((weight / total) * 10000) / 100,
  );
  const gap =
    Math.round((100 - shares.reduce((sum, share) => sum + share, 0)) * 100) /
    100;
  const biggest = shares.indexOf(Math.max(...shares));
  shares[biggest] = Math.round((shares[biggest] + gap) * 100) / 100;
  return shares;
};

export const automaticSharesOf = (
  equipment: EquipmentInput[],
  criterion: Automatic,
) =>
  toPercentages(
    equipment.map((item) =>
      criterion === 'ACQUISITION_VALUE'
        ? item.acquisitionValue
        : item.activityHours,
    ),
  );

/**
 * O percentual de cada equipamento pelo critério. O tempo de atividade sem
 * nenhum tempo informado cai no valor de aquisição (ORG-33); no manual, o
 * bem que entrou depois fica com zero até a empresa salvar de novo.
 */
export const sharesOf = (
  equipment: EquipmentInput[],
  criterion: Criterion,
  manual: Map<string, number>,
): number[] => {
  if (criterion === 'MANUAL') {
    return equipment.map((item) => manual.get(item.id) ?? 0);
  }
  const shares = automaticSharesOf(equipment, criterion);
  if (shares.every((share) => share === null)) {
    return automaticSharesOf(equipment, 'ACQUISITION_VALUE').map(
      (share) => share ?? 0,
    );
  }
  return shares.map((share) => share ?? 0);
};

export const allocationOf = (input: {
  criterion: Criterion;
  manual: Map<string, number>;
  pool: number;
  equipment: EquipmentInput[];
}) => {
  const { equipment, pool } = input;
  const inUse = sharesOf(equipment, input.criterion, input.manual);
  const byAcquisition = automaticSharesOf(equipment, 'ACQUISITION_VALUE');
  const byActivity = automaticSharesOf(equipment, 'ACTIVITY_TIME');
  return {
    pool,
    equipment: equipment.map((item, index) => {
      const monthlyCost =
        item.ownCost + Math.round((pool * inUse[index]) / 100);
      return {
        id: item.id,
        name: item.name,
        acquisitionValue: item.acquisitionValue,
        activityHours: Math.round(item.activityHours * 100) / 100,
        ownCost: item.ownCost,
        shares: {
          ACQUISITION_VALUE: byAcquisition[index],
          ACTIVITY_TIME: byActivity[index],
          MANUAL:
            input.criterion === 'MANUAL'
              ? (input.manual.get(item.id) ?? 0)
              : null,
        },
        share: inUse[index],
        // A parte do setor que o bem recebe, para o custo das configurações
        poolShare: monthlyCost - item.ownCost,
        monthlyCost,
        hourCost:
          item.activityHours > 0
            ? Math.round(monthlyCost / item.activityHours)
            : null,
      };
    }),
    missingTime: equipment
      .filter((item) => !(item.activityHours > 0))
      .map((item) => item.name),
  };
};

/**
 * O rateio manual fecha 100 % pelo valor, com 1 centavo de tolerância
 * (BC-3.1, BC-9); sem custo a repartir, pelos percentuais.
 */
export const manualFits = (pool: number, percentages: number[]) =>
  Math.abs(percentages.reduce((sum, percentage) => sum + percentage, 0) - 100) <
    0.0001 ||
  (pool > 0 &&
    Math.abs(
      percentages.reduce(
        (sum, percentage) => sum + Math.round((pool * percentage) / 100),
        0,
      ) - pool,
    ) <= 1);
