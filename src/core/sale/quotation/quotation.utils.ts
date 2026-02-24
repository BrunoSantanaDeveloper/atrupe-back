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

/** Tamanhos de imagem disponíveis para produtos do orçamento */
export type ImageSize = 'small' | 'large';

/** Tamanho padrão para novas imagens de produto */
export const DEFAULT_IMAGE_SIZE: ImageSize = 'small';

/** Tamanho fallback para imagens sem imageSize definido (imagens não-originais) */
export const FALLBACK_IMAGE_SIZE: ImageSize = 'large';
