import { PricingCharges } from '../material/material-pricing';

/**
 * As contas da precificação (PR-1 a PR-4, D3 §7.2), sem banco. Encargos e
 * lucro em décimos de ponto (60 = 6,0 %); dinheiro em centavos.
 */

export type PricingParams = PricingCharges & { desiredMargin: number };

export const ZERO_PARAMS: PricingParams = {
  taxation: 0,
  commission: 0,
  financialCost: 0,
  desiredMargin: 0,
};

/** Tributação + comissão + custo financeiro: o que sai de todo preço. */
export const chargesTotalOf = (charges: PricingCharges) =>
  charges.taxation + charges.commission + charges.financialCost;

/**
 * O markup pelo método divisor: 1 ÷ (1 − encargos − lucro), com duas casas.
 * Nulo quando encargos e lucro somam 100 % ou mais.
 */
export const markupOf = (params: PricingParams) => {
  const total = chargesTotalOf(params) + params.desiredMargin;
  return total < 1000 ? Math.round(100 / (1 - total / 1000)) / 100 : null;
};

/** O lucro cabe no preço: 1 − encargos − lucro > 0. */
export const profitFits = (charges: PricingCharges, profit: number) =>
  1 - (chargesTotalOf(charges) + profit) / 1000 > 0;

/**
 * A margem do preço (PR-2): o lucro depois dos encargos, em % do preço, com
 * uma casa. É a mesma leitura do modal de preço.
 */
export const marginAfterChargesOf = (
  price: number | null,
  cost: number | null,
  charges: PricingCharges,
) =>
  price && price > 0 && cost !== null
    ? Math.round(
        ((price - cost - (price * chargesTotalOf(charges)) / 1000) / price) *
          1000,
      ) / 10
    : null;
