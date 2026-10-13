import { ItemType, PayrollBehavior } from '@prisma/client';

/**
 * As contas da folha com comportamento (ALT-18, ALT-19, F-14), sem banco.
 * Valores em centavos. O type/amount antigo continua para as telas de hoje e
 * fica em sincronia com o comportamento, o acréscimo e o desconto.
 */

export type PayrollLine = {
  isSet: boolean;
  behavior: PayrollBehavior | null;
  increase: number | null;
  discount: number | null;
  type: ItemType;
  amount: number;
};

/** O comportamento, o acréscimo e o desconto de uma linha (o antigo, se faltar). */
export const valuesOf = (line: PayrollLine) => {
  if (line.behavior) {
    return {
      behavior: line.behavior,
      increase: line.increase ?? 0,
      discount: line.discount ?? 0,
    };
  }
  return fromLegacy(line.type, line.amount);
};

/** O type/amount antigo a partir do comportamento. */
export const legacyOf = (
  behavior: PayrollBehavior,
  increase: number,
  discount: number,
): { type: ItemType; amount: number } => {
  switch (behavior) {
    case 'ONLY_DISCOUNT':
      return { type: 'DISCOUNT', amount: discount };
    case 'ADVANCE':
      return { type: 'ADVANCE', amount: increase };
    case 'INCREASE_AND_DISCOUNT': {
      const net = increase - discount;
      return net >= 0
        ? { type: 'INCREASE', amount: net }
        : { type: 'DISCOUNT', amount: -net };
    }
    default:
      return { type: 'INCREASE', amount: increase };
  }
};

/** O comportamento a partir do type/amount antigo. */
export const fromLegacy = (type: ItemType, amount: number) => {
  const value = Math.round(amount || 0);
  switch (type) {
    case 'DISCOUNT':
      return {
        behavior: 'ONLY_DISCOUNT' as const,
        increase: 0,
        discount: value,
      };
    case 'ADVANCE':
      return { behavior: 'ADVANCE' as const, increase: value, discount: 0 };
    default:
      return {
        behavior: 'ONLY_INCREASE' as const,
        increase: value,
        discount: 0,
      };
  }
};

/** O comportamento manda no que pode ter valor (ONLY_* zera o outro lado). */
export const coherent = (
  behavior: PayrollBehavior,
  increase: number,
  discount: number,
) => ({
  behavior,
  increase: behavior === 'ONLY_DISCOUNT' ? 0 : Math.max(0, increase),
  discount:
    behavior === 'ONLY_INCREASE' ||
    behavior === 'PROVISION' ||
    behavior === 'ADVANCE'
      ? 0
      : Math.max(0, discount),
});

/**
 * O custo da linha para a empresa: acréscimo menos desconto, nunca
 * negativo; a linha fora da folha não custa. O adiantamento é parte do
 * salário já contado, não custo a mais.
 */
export const finalCostOf = (line: PayrollLine) => {
  if (!line.isSet) return 0;
  const { behavior, increase, discount } = valuesOf(line);
  if (behavior === 'ADVANCE') return 0;
  return Math.max(0, increase - discount);
};

/**
 * Os totais do colaborador: o custo (é o custo de mão de obra do setor na
 * base de custos, ALT-19) e a folha a pagar (sem as provisões nem o
 * adiantamento).
 */
export const employeeTotalsOf = (lines: PayrollLine[]) => {
  let employeeCost = 0;
  let employeePayroll = 0;
  let totalIncrease = 0;
  let totalDiscount = 0;
  for (const line of lines) {
    if (!line.isSet) continue;
    const { behavior, increase, discount } = valuesOf(line);
    employeeCost += finalCostOf(line);
    if (behavior === 'ADVANCE') continue;
    totalIncrease += increase;
    totalDiscount += discount;
    if (behavior !== 'PROVISION') employeePayroll += increase - discount;
  }
  return { employeeCost, employeePayroll, totalIncrease, totalDiscount };
};

/**
 * Os lançamentos da folha mensal de uma linha: a provisão não é paga no mês;
 * o acréscimo e o desconto viram dois lançamentos. Acréscimo, desconto e
 * adiantamento saem do type/amount, que fica em sincronia: o lançamento é o
 * de sempre, sem o arredondamento do backfill.
 */
export const payrollEntriesOf = (
  line: PayrollLine,
): { type: ItemType; amount: number }[] => {
  switch (line.behavior) {
    case 'PROVISION':
      return [];
    case 'INCREASE_AND_DISCOUNT': {
      const { increase, discount } = valuesOf(line);
      return [
        ...(increase > 0
          ? [{ type: 'INCREASE' as const, amount: increase }]
          : []),
        ...(discount > 0
          ? [{ type: 'DISCOUNT' as const, amount: discount }]
          : []),
      ];
    }
    default:
      return [{ type: line.type, amount: line.amount }];
  }
};

/**
 * A linha nova de um colaborador a partir do item da empresa: os valores
 * padrão do item, com o type/amount junto. Os encargos nascem fora da
 * folha e entram pelo salário base, só para CLT.
 */
export const setupFromTemplate = (template: {
  name: string;
  type: ItemType;
  defaultAmount: number | null;
  behavior: PayrollBehavior | null;
  defaultIncrease: number | null;
  defaultDiscount: number | null;
  derivedFromSalary: boolean;
}) => {
  if (!template.behavior) {
    return {
      name: template.name,
      type: template.type,
      amount: template.defaultAmount || 0,
      isSet: true,
    };
  }
  const values = coherent(
    template.behavior,
    template.defaultIncrease ?? 0,
    template.defaultDiscount ?? 0,
  );
  return {
    name: template.name,
    ...values,
    ...legacyOf(values.behavior, values.increase, values.discount),
    isSet: !template.derivedFromSalary,
  };
};

/** Os itens da folha que o sistema gera do salário base (ALT-18). */
export const CHARGE_KEYS = ['INSS', 'FGTS', 'THIRTEENTH', 'VACATION'] as const;
export type ChargeKey = (typeof CHARGE_KEYS)[number];

export const CHARGE_TEMPLATES: Record<
  ChargeKey,
  {
    name: string;
    behavior: PayrollBehavior;
    rate: number | null;
    fixedByLaw: boolean;
  }
> = {
  INSS: {
    name: 'INSS',
    behavior: 'INCREASE_AND_DISCOUNT',
    rate: 8,
    fixedByLaw: false,
  },
  FGTS: { name: 'FGTS', behavior: 'PROVISION', rate: 8, fixedByLaw: false },
  THIRTEENTH: {
    name: '13º salário + FGTS + INSS',
    behavior: 'PROVISION',
    rate: null,
    fixedByLaw: true,
  },
  VACATION: {
    name: 'Férias + FGTS + INSS',
    behavior: 'PROVISION',
    rate: null,
    fixedByLaw: true,
  },
};

/**
 * Os encargos da CLT a partir do salário base (F-14): INSS e FGTS pelas
 * alíquotas dos itens da empresa; 13º e férias 1/12 ao mês cada, com INSS e
 * FGTS sobre eles. Pró-labore e MEI/PJ não têm encargos da CLT (F-9, F-10).
 */
export const chargesOf = (
  contract: 'CLT' | 'PRO_LABORE' | 'MEI_PJ' | null,
  baseSalary: number,
  rates: { inss: number; fgts: number },
): Record<ChargeKey, { increase: number; discount: number }> | null => {
  if (contract !== 'CLT' || !(baseSalary > 0)) return null;
  const inss = Math.round((baseSalary * rates.inss) / 100);
  const fgts = Math.round((baseSalary * rates.fgts) / 100);
  const twelfth = baseSalary / 12;
  const withCharges = Math.round(
    twelfth * (1 + (rates.inss + rates.fgts) / 100),
  );
  return {
    INSS: { increase: inss, discount: inss },
    FGTS: { increase: fgts, discount: 0 },
    THIRTEENTH: { increase: withCharges, discount: 0 },
    VACATION: { increase: withCharges, discount: 0 },
  };
};
