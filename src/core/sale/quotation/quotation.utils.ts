/**
 * Calcula o valor final aplicando desconto sobre o valor total.
 * Centraliza a lógica de desconto que era duplicada em 4+ locais.
 */
export function calculateFinalValue(
  totalValue: number,
  discount: number | null,
  discountType: string | null,
): number {
  if (!discount || !discountType) return totalValue;

  if (discountType === 'VALUE') {
    return totalValue - discount;
  }
  if (discountType === 'PERCENT') {
    return totalValue - totalValue * (discount / 100);
  }
  return totalValue;
}
