/**
 * A mão de obra do setor (F-11): o custo do setor (próprio + recebido) pela
 * carga horária do mês, que é a soma das horas de cada colaborador. A margem
 * é a da precificação (PR-3): o lucro depois dos encargos sobre o preço.
 */

/** Horas arredondadas ao minuto (design.md §6.8). */
export const toMinute = (hours: number) => Math.round(hours * 60) / 60;

/**
 * Margem em % com uma casa: (preço − encargos − custo) ÷ preço. Os encargos
 * (impostos, comissão, custo financeiro) vêm em décimos de ponto.
 */
export const marginOf = (
  price: number | null,
  cost: number | null,
  charges: number,
) =>
  price && price > 0 && cost !== null
    ? Math.round(((price - (price * charges) / 1000 - cost) / price) * 1000) /
      10
    : null;

export const laborOf = (input: {
  totalCost: number | null;
  hours: number[];
  salePrice: number | null;
  charges: number;
}) => {
  const total = input.hours.reduce((sum, hours) => sum + hours, 0);
  const hours = total > 0 ? Math.round(total * 100) / 100 : null;
  const costPerHour =
    hours !== null ? Math.round((input.totalCost ?? 0) / total) : null;
  return {
    distributedCost: input.totalCost,
    hours,
    costPerHour,
    salePrice: input.salePrice,
    margin: marginOf(input.salePrice, costPerHour, input.charges),
  };
};
