import { AssetUnit } from '@prisma/client';
import { UNIT_SYMBOL, normalizeText } from '../../material/material-text';

/**
 * O comparativo da base de custos (§10), sem banco: o previsto de cada
 * fonte é a estimativa unitária do cadastro × o volume do período. O volume
 * do bem sai, nesta ordem, das leituras do contador, do vendido pelas
 * composições ou da produtividade do cadastro × meses; o custo financeiro é
 * o percentual da Precificação × o recebido; o material, o estimado nas
 * composições vendidas. Dinheiro em centavos.
 */

/* --------------------------------------------------------------- leituras */

/** Uma leitura do contador: o dia (meia-noite UTC) e o valor. */
export type Reading = { date: Date; value: number };

/**
 * O volume do bem pelas leituras (a): a última até o fim do período menos a
 * última antes do início (sem ela, a primeira de dentro do período). Com
 * menos de duas leituras, nulo. No mesmo dia, o contador maior é o mais
 * recente.
 */
export const readingVolumeOf = (
  readings: Reading[],
  start: Date,
  end: Date,
): number | null => {
  const sorted = [...readings].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.value - b.value,
  );
  const untilEnd = sorted.filter((reading) => reading.date < end);
  const last = untilEnd[untilEnd.length - 1];
  const before = untilEnd.filter((reading) => reading.date < start);
  const first = before.length
    ? before[before.length - 1]
    : untilEnd.find((reading) => reading.date >= start);
  if (!last || !first || last === first) return null;
  return Math.max(0, last.value - first.value);
};

/* ------------------------------------------------------ o que foi vendido */

/** Um recurso usado na venda: a linha do retrato ou a entrada da lista. */
export type SoldUse = {
  kind: string;
  resourceId: string | null;
  quantity: number;
  unit: string;
  cost: number;
};

type Raw = Record<string, unknown>;

const isRaw = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

const useOf = (entry: Raw, kind: string): SoldUse => ({
  kind,
  resourceId: text(entry.resourceId) || null,
  quantity: num(entry.quantity),
  unit: text(entry.unit),
  cost: num(entry.cost),
});

/**
 * Os recursos de um retrato (ORC-10), qualquer que seja a origem: as etapas
 * do item (as linhas da parte já vêm somadas na etapa), as linhas
 * resolvidas do processo acrescentado ou as etapas da parte acrescentada.
 * As caixas de dentro da parte (`parts`, FL-10) repetem linhas que já estão
 * na etapa, sem custo, e não entram. Na lista, cada entrada informada é um
 * uso (o custo da linha é a soma delas).
 */
export const usesOf = (data: unknown): SoldUse[] => {
  const entries: unknown[] = Array.isArray(data)
    ? data
    : isRaw(data) && Array.isArray(data.stages)
      ? data.stages
      : [];
  return entries.filter(isRaw).flatMap((entry) => {
    if (Array.isArray(entry.lines)) return usesOf(entry.lines);
    const kind = text(entry.kind);
    const listed = Array.isArray(entry.entries)
      ? entry.entries.filter(isRaw)
      : [];
    return listed.length
      ? listed.map((item) => useOf(item, kind))
      : [useOf(entry, kind)];
  });
};

/* --------------------------------------------------- volume das máquinas */

export type MachineSetup = {
  id: string;
  unit: AssetUnit;
  /** Minutos por unidade */
  timePerUnit: number;
  monthlyProductivity: number;
};

export type MachineAsset = {
  id: string;
  groupId: string | null;
  /** A produtividade do bem: a soma das configurações, quando há (P-31) */
  productivity: number;
  setups: MachineSetup[];
};

export type MachineGroup = { id: string; unit: AssetUnit };

export type SoldVolumes = {
  /** Unidades vendidas de cada configuração */
  setups: Map<string, number>;
  /** Unidades vendidas de cada bem */
  assets: Map<string, number>;
};

/** `machine:<id>` → ['machine', '<id>']; `machine-group:<id>`, idem. */
const resourceOf = (resourceId: string) => {
  const at = resourceId.indexOf(':');
  return at < 0
    ? ['', '']
    : [resourceId.slice(0, at), resourceId.slice(at + 1)];
};

// O tempo da linha em minutos; fora de unidade de tempo, nulo
const minutesOf = (use: SoldUse) =>
  use.unit === 'min'
    ? use.quantity
    : use.unit === 'h'
      ? use.quantity * 60
      : null;

/**
 * A quantidade da linha em unidades da configuração. A linha de máquina vem
 * na unidade da configuração (m², km, h: o recurso é ela); a que vier em
 * tempo vira unidades pelo tempo por unidade. Sem como converter (outra
 * unidade, ou tempo sem tempo por unidade), nula: não conta.
 */
const unitsOf = (use: SoldUse, unit: AssetUnit, timePerUnit: number) => {
  if (use.unit === UNIT_SYMBOL[unit]) return use.quantity;
  const minutes = minutesOf(use);
  return minutes !== null && timePerUnit > 0 ? minutes / timePerUnit : null;
};

/**
 * O volume vendido (b) de cada configuração e de cada bem. A linha
 * `machine:<configuração>` vai para a configuração; a
 * `machine-group:<grupo>` se reparte entre as configurações dos bens do
 * grupo na proporção da produtividade mensal delas (o bem do grupo sem
 * configuração entra pela produtividade dele; sem produtividade nenhuma, em
 * partes iguais). O volume do bem é a soma das suas configurações.
 */
export const soldVolumesOf = (
  uses: SoldUse[],
  assets: MachineAsset[],
  groups: MachineGroup[],
): SoldVolumes => {
  const setupOf = new Map(
    assets.flatMap((asset) =>
      asset.setups.map((setup) => [setup.id, setup] as const),
    ),
  );
  const groupOf = new Map(groups.map((group) => [group.id, group]));
  const slotsOf = new Map<
    string,
    { assetId: string; setup: MachineSetup | null; weight: number }[]
  >();
  const bySetup = new Map<string, number>();
  const byAsset = new Map<string, number>();
  const add = (map: Map<string, number>, id: string, value: number) =>
    map.set(id, (map.get(id) ?? 0) + value);

  for (const use of uses) {
    if (!use.resourceId || !(use.quantity > 0)) continue;
    const [prefix, id] = resourceOf(use.resourceId);
    if (prefix === 'machine') {
      const setup = setupOf.get(id);
      const units = setup ? unitsOf(use, setup.unit, setup.timePerUnit) : null;
      if (setup && units) add(bySetup, setup.id, units);
      continue;
    }
    const group = prefix === 'machine-group' ? groupOf.get(id) : undefined;
    if (!group) continue;
    if (!slotsOf.has(group.id)) {
      slotsOf.set(
        group.id,
        assets
          .filter((asset) => asset.groupId === group.id)
          .flatMap((asset) =>
            asset.setups.length
              ? asset.setups.map((setup) => ({
                  assetId: asset.id,
                  setup,
                  weight: Math.max(0, setup.monthlyProductivity),
                }))
              : [
                  {
                    assetId: asset.id,
                    setup: null,
                    weight: Math.max(0, asset.productivity),
                  },
                ],
          ),
      );
    }
    const slots = slotsOf.get(group.id)!;
    const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
    const sameUnit = use.unit === UNIT_SYMBOL[group.unit];
    const minutes = minutesOf(use);
    for (const slot of slots) {
      const share = total > 0 ? slot.weight / total : 1 / slots.length;
      const units = sameUnit
        ? use.quantity * share
        : minutes !== null && slot.setup && slot.setup.timePerUnit > 0
          ? (minutes * share) / slot.setup.timePerUnit
          : 0;
      if (!(units > 0)) continue;
      if (slot.setup) add(bySetup, slot.setup.id, units);
      else add(byAsset, slot.assetId, units);
    }
  }
  for (const asset of assets) {
    for (const setup of asset.setups) {
      const units = bySetup.get(setup.id);
      if (units) add(byAsset, asset.id, units);
    }
  }
  return { setups: bySetup, assets: byAsset };
};

/* -------------------------------------------------------------- as fontes */

export type VolumeBasis = 'READINGS' | 'SOLD' | 'PRODUCTIVITY';

/** O volume do período e de onde ele saiu. */
export type PeriodVolume = {
  basis: VolumeBasis;
  volume: number;
  /** A produtividade do cadastro, por mês */
  perMonth: number;
};

/**
 * O volume na ordem de preferência: as leituras (a), o vendido (b) ou a
 * produtividade do cadastro × meses (c). Sem venda no período, vale a
 * produtividade. A configuração não tem leitura (nula).
 */
export const volumeOf = (input: {
  readings: number | null;
  sold: number;
  productivity: number;
  months: number;
}): PeriodVolume =>
  input.readings !== null
    ? {
        basis: 'READINGS',
        volume: input.readings,
        perMonth: input.productivity,
      }
    : input.sold > 0
      ? { basis: 'SOLD', volume: input.sold, perMonth: input.productivity }
      : {
          basis: 'PRODUCTIVITY',
          volume: input.productivity * input.months,
          perMonth: input.productivity,
        };

export type ComparisonSource = {
  id: string;
  name: string;
  detail: string;
  value: number;
};

const numberText = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** R$ 1.234,56; com `digits`, até tantas casas (a fração de centavo). */
export const moneyText = (cents: number, digits = 2) =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.max(2, digits),
  })}`;

const monthsText = (months: number) =>
  `${months} ${months === 1 ? 'mês' : 'meses'}`;

export type AssetCostInput = {
  id: string;
  /** O nome do custo; no variável da configuração, com o nome dela */
  label: string;
  unitCost: number;
  yieldAmount: number;
  yieldUnit: 'MONTH' | 'UNIT';
  /** O custo no mês, como o cadastro calcula */
  monthlyCost: number;
};

/**
 * A fonte de um custo do bem. O fixo continua o custo mensal × meses ("a
 * cada 6 meses"); o variável é o custo por unidade (centavos ÷ rendimento) ×
 * o volume do período, arredondado ao centavo, e o texto diz a base:
 * "Tinta — R$ 0,50/m² × 1.234 m² vendidos".
 */
export const assetCostSourceOf = (input: {
  assetName: string;
  unit: AssetUnit | null;
  cost: AssetCostInput;
  volume: PeriodVolume;
  months: number;
}): ComparisonSource => {
  const { cost, months } = input;
  if (cost.yieldUnit === 'MONTH') {
    return {
      id: cost.id,
      name: input.assetName,
      detail: `${cost.label} — ${
        cost.yieldAmount === 1
          ? 'todo mês'
          : `a cada ${numberText(cost.yieldAmount)} meses`
      }`,
      value: cost.monthlyCost * months,
    };
  }
  const symbol = input.unit ? UNIT_SYMBOL[input.unit] : null;
  const amount = (value: number) =>
    symbol ? `${numberText(value)} ${symbol}` : numberText(value);
  const rate = cost.yieldAmount > 0 ? cost.unitCost / cost.yieldAmount : 0;
  const base = `${cost.label} — ${moneyText(rate, 4)}${
    symbol ? `/${symbol}` : ' por unidade'
  }`;
  const { basis, volume, perMonth } = input.volume;
  return {
    id: cost.id,
    name: input.assetName,
    detail:
      basis === 'READINGS'
        ? `${base} × ${amount(volume)} pelas leituras`
        : basis === 'SOLD'
          ? `${base} × ${amount(volume)} vendidos`
          : `${base} pela produtividade do cadastro (${amount(perMonth)}/mês × ${monthsText(months)})`,
    value: Math.round(rate * volume),
  };
};

/* ------------------------------------------- custo financeiro e material */

/**
 * O custo financeiro (PR-4) sobre o recebido no período: o percentual da
 * Precificação, em décimos de ponto (15 = 1,5 %), × o que entrou. Sem
 * percentual informado, não há estimativa (nula).
 */
export const financialCostSourceOf = (
  financialCost: number,
  received: number,
): ComparisonSource | null =>
  financialCost > 0
    ? {
        id: 'financial-cost',
        name: 'Custo financeiro',
        detail: `${(financialCost / 10).toLocaleString('pt-BR', {
          maximumFractionDigits: 1,
        })}% do recebido (${moneyText(received)})`,
        value: Math.round((received * financialCost) / 1000),
      }
    : null;

/** Um item vendido como o comparativo lê. */
export type SoldItem = {
  origin: string;
  quantity: number;
  /** Centavos por unidade do material de venda direta, hoje */
  materialCost: number | null;
  /** Os recursos do retrato do item e das linhas acrescentadas nele */
  uses: SoldUse[];
};

/**
 * O material estimado de um item vendido: as linhas de material do retrato
 * do item e das linhas acrescentadas, pelo custo guardado na venda (as da
 * parte já estão somadas na etapa); o material de venda direta (ORG-1), pela
 * quantidade × o custo de hoje do material ou da variação, que a venda não
 * guarda.
 */
export const itemMaterialCostOf = (item: SoldItem) =>
  item.uses
    .filter((use) => use.kind === 'MATERIAL')
    .reduce((sum, use) => sum + use.cost, 0) +
  (item.origin === 'MATERIAL' ? item.quantity * (item.materialCost ?? 0) : 0);

/** O material das composições vendidas no período, com quantas vendas. */
export const materialSourceOf = (
  cost: number,
  sales: number,
): ComparisonSource => ({
  id: 'sold-material',
  name: 'Material das vendas',
  detail: `Material das composições vendidas (${sales} ${
    sales === 1 ? 'venda' : 'vendas'
  })`,
  value: Math.round(cost),
});

/* --------------------------------------------------- as contas das fontes */

export type ExpenseAccount = {
  id: string;
  description: string | null;
  nature: { description: string | null };
};

/**
 * A conta padrão de cada fonte sem bem, pela descrição do plano de contas
 * que toda empresa ganha, sem acento e sem caixa: "Matéria Prima"
 * (Operacional) e "Tarifa de Cartão de Crédito" (Despesas Financeiras).
 */
export const DEFAULT_ACCOUNTS = {
  material: { account: 'materia prima', nature: 'operacional' },
  financialCost: {
    account: 'tarifa de cartao de credito',
    nature: 'despesas financeiras',
  },
} as const;

// Sem acento e sem caixa; o hífen ("matéria-prima") conta como espaço
const keyOf = (value: string | null) =>
  normalizeText((value ?? '').replace(/[-‐–]/g, ' '));

/**
 * A conta padrão entre as elegíveis (na ordem do plano): a da descrição na
 * natureza esperada; se a empresa mudou a natureza, a da descrição em
 * qualquer uma. Sem nenhuma, nula: a fonte não aparece.
 */
export const defaultAccountOf = (
  accounts: ExpenseAccount[],
  target: { account: string; nature: string },
) => {
  const named = accounts.filter(
    (account) => keyOf(account.description) === target.account,
  );
  return (
    named.find(
      (account) => keyOf(account.nature.description) === target.nature,
    ) ??
    named[0] ??
    null
  );
};

/** As contas escolhidas em CostBaseSettings (nula: o padrão). */
export type ChosenAccounts = {
  materialSubCategoryId: string | null;
  financialCostSubCategoryId: string | null;
};

/**
 * A conta de cada fonte sem bem: a escolhida, enquanto ela for uma das
 * contas do comparativo (ativa, de despesa, fora do administrativo); senão,
 * a do padrão. Sem nenhuma das duas, nula.
 */
export const sourceAccountsOf = (
  accounts: ExpenseAccount[],
  chosen: ChosenAccounts | null,
) => {
  const valid = (id: string | null | undefined) =>
    id && accounts.some((account) => account.id === id) ? id : null;
  return {
    material:
      valid(chosen?.materialSubCategoryId) ??
      defaultAccountOf(accounts, DEFAULT_ACCOUNTS.material)?.id ??
      null,
    financialCost:
      valid(chosen?.financialCostSubCategoryId) ??
      defaultAccountOf(accounts, DEFAULT_ACCOUNTS.financialCost)?.id ??
      null,
  };
};
