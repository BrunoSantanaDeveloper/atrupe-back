/**
 * Os números do preço do material que a tela não calcula mais (SEG-1): a
 * margem, a situação do preço e o preço variável.
 */

export type PriceStatus = 'PRICED' | 'PENDING' | 'BELOW_COST' | 'NO_COST';

/** Os encargos da Precificação, em décimos de ponto (60 = 6,0 %). */
export type PricingCharges = {
  taxation: number;
  financialCost: number;
  commission: number;
};

/** (preço − custo) ÷ preço × 100, com uma casa. */
export const marginOf = (
  cost: number | null,
  price: number | null,
): number | null =>
  cost !== null && price
    ? Math.round(((price - cost) / price) * 1000) / 10
    : null;

export const priceStatusOf = (
  cost: number | null,
  price: number | null,
): PriceStatus => {
  if (cost === null) return 'NO_COST';
  if (!price) return 'PENDING';
  return price < cost ? 'BELOW_COST' : 'PRICED';
};

/**
 * Preço variável (PR-4), pelo método divisor: custo ÷ (1 − tributação −
 * custo financeiro − comissão − lucro), arredondado ao centavo. O lucro vem
 * em décimos de ponto (300 = 30,0 %). Nulo quando encargos e lucro somam
 * 100 % ou mais: não há preço que os pague.
 */
export const variablePriceOf = (
  cost: number,
  desiredMargin: number,
  charges: PricingCharges,
): number | null => {
  const divisor =
    1 -
    (charges.taxation +
      charges.financialCost +
      charges.commission +
      desiredMargin) /
      1000;
  return divisor > 0 ? Math.round(cost / divisor) : null;
};
