import { SectorAllocationCriterion, SectorNature } from '@prisma/client';

/**
 * O custo de cada setor (D3 §1): quatro origens, cada uma do seu cadastro.
 * `LABOR` é a folha dos colaboradores do setor (ALT-19); `DEPRECIATION`, a
 * depreciação dos bens; `ASSETS`, os custos fixos mensais dos bens; `OTHER`,
 * as despesas administrativas e o que foi rateado por item (BC-8). O total
 * dos setores administrativos é distribuído entre os produtivos pelo
 * percentual de cada um (BC-5, BC-7). Valores em centavos.
 */

export type CostOrigin = 'LABOR' | 'ASSETS' | 'DEPRECIATION' | 'OTHER';

export type SectorCostItem = {
  id: string;
  name: string;
  origin: CostOrigin;
  detail: string;
  value: number;
  // O bem de onde o item sai: o rateio entre equipamentos separa os itens
  // do equipamento detalhado do resto do setor
  assetId?: string;
};

export type SectorInput = {
  id: string;
  name: string;
  nature: SectorNature;
  distributionPercentage: number;
  allocationCriterion: SectorAllocationCriterion;
  items: SectorCostItem[];
};

// Sem item, a origem não tem custo: nula, nunca zero (DC-15)
const sumOrNull = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) : null;

export const receivedOf = (administrativeCost: number, percentage: number) =>
  Math.round((administrativeCost * percentage) / 100);

export const sectorCostsOf = (sectors: SectorInput[]) => {
  const own = sectors.map((sector) => {
    const items = sector.items.filter((item) => item.value > 0);
    const origin = (name: CostOrigin) =>
      sumOrNull(
        items.filter((item) => item.origin === name).map((item) => item.value),
      );
    return {
      ...sector,
      items,
      labor: origin('LABOR'),
      assets: origin('ASSETS'),
      depreciation: origin('DEPRECIATION'),
      other: origin('OTHER'),
      ownCost: sumOrNull(items.map((item) => item.value)),
    };
  });
  const administrativeCost = own
    .filter((sector) => sector.nature === 'ADMINISTRATIVE')
    .reduce((sum, sector) => sum + (sector.ownCost ?? 0), 0);
  const rows = own.map((sector) => {
    const percentage =
      sector.nature === 'PRODUCTIVE' ? sector.distributionPercentage : 0;
    const receivedCost =
      percentage > 0 ? receivedOf(administrativeCost, percentage) : null;
    const totalCost =
      sector.ownCost === null && receivedCost === null
        ? null
        : (sector.ownCost ?? 0) + (receivedCost ?? 0);
    return { ...sector, percentage, receivedCost, totalCost };
  });
  const distributedCost = rows.reduce(
    (sum, sector) => sum + (sector.receivedCost ?? 0),
    0,
  );
  return {
    administrativeCost,
    distributedCost,
    isDistributing: rows.some((sector) => sector.percentage > 0),
    sectors: rows,
  };
};

export type SectorCosts = ReturnType<typeof sectorCostsOf>;

/** O resumo (aba Resumo): o mesmo cálculo do Por setor, consolidado. */
export const summaryOf = (costs: SectorCosts) => {
  const sum = (
    pick: (sector: SectorCosts['sectors'][number]) => number | null,
  ) => costs.sectors.reduce((total, sector) => total + (pick(sector) ?? 0), 0);
  const productiveCost = sum((sector) =>
    sector.nature === 'PRODUCTIVE' ? sector.ownCost : null,
  );
  return {
    total: productiveCost + costs.administrativeCost,
    byOrigin: {
      adminExpenses: sum((sector) => sector.other),
      labor: sum((sector) => sector.labor),
      assets: sum((sector) => sector.assets),
      depreciation: sum((sector) => sector.depreciation),
    },
    productiveCost,
    administrativeCost: costs.administrativeCost,
    distributedCost: costs.distributedCost,
    bySector: costs.sectors
      .filter((sector) => (sector.ownCost ?? 0) > 0)
      .map((sector) => ({
        id: sector.id,
        name: sector.name,
        value: sector.ownCost as number,
      }))
      .sort((a, b) => b.value - a.value),
  };
};

/**
 * A soma da distribuição conferida pelo valor, com 1 centavo de tolerância
 * (BC-5, design.md §6.8); sem custo administrativo, pelos percentuais.
 */
export const distributionFits = (
  administrativeCost: number,
  percentages: number[],
) =>
  administrativeCost > 0
    ? percentages.reduce(
        (sum, percentage) => sum + receivedOf(administrativeCost, percentage),
        0,
      ) <=
      administrativeCost + 1
    : percentages.reduce((sum, percentage) => sum + percentage, 0) <= 100;
