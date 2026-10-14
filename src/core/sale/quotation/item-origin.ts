/**
 * O item do orçamento sem produto do cadastro (Fase 4.4 e 4.5, decisões do
 * PO de 14/10/2026): o material de venda direta (`MATERIAL`) e o item
 * montado na hora (`COMPOSED`). Eles não têm as linhas de composição do
 * produto (`QuotationProductItem`): o valor fica no próprio item.
 */

type ValueRow = {
  unitCost?: number | null;
  totalValue?: number | null;
  salePrice?: number | null;
  productItem?: { salePrice?: number | null } | null;
};

type ItemValues = {
  productId?: string | null;
  quantity?: number | null;
  totalValue?: number | null;
  unitPrice?: number | null;
  items?: ValueRow[] | null;
};

/** Valor por unidade, valor e valor de catálogo do item, em centavos. */
export function itemValuesOf(qp: ItemValues) {
  const rows = qp.items ?? [];
  if (qp.productId || rows.length) {
    return {
      unitValue: rows.reduce((sum, row) => sum + (row.unitCost || 0), 0),
      totalValue: rows.reduce((sum, row) => sum + (row.totalValue || 0), 0),
      // O preço do catálogo, que a edição no orçamento não muda
      originalValue: rows.reduce(
        (sum, row) => sum + (row.productItem?.salePrice ?? row.salePrice ?? 0),
        0,
      ),
    };
  }
  const totalValue = qp.totalValue ?? 0;
  const quantity = qp.quantity || 1;
  const unitValue = qp.unitPrice ?? Math.round(totalValue / quantity);
  return { unitValue, totalValue, originalValue: unitValue };
}

/** O nome da variação do material: marca e cor. */
export const materialVariationName = (
  variation?: { brand?: string | null; color?: string | null } | null,
) =>
  variation
    ? [variation.brand, variation.color].filter(Boolean).join(' ') || null
    : null;

/** O nome do material vendido, com a variação: "Lona 440 · Marca X Branca". */
export const materialItemName = (
  material: { name: string },
  variation?: { brand?: string | null; color?: string | null } | null,
) => {
  const variationName = materialVariationName(variation);
  return variationName ? `${material.name} · ${variationName}` : material.name;
};

/**
 * O que foi vendido, para os relatórios: o produto; o material com a
 * variação; ou o item montado, pelo nome dele.
 */
export function soldItemOf(qp: {
  productId?: string | null;
  materialId?: string | null;
  materialVariationId?: string | null;
  description?: string | null;
  product?: { name?: string | null } | null;
  material?: { name: string } | null;
  materialVariation?: { brand?: string | null; color?: string | null } | null;
}) {
  if (qp.productId) {
    return {
      key: `p:${qp.productId}`,
      name: qp.product?.name || 'Produto',
      type: 'Produto',
    };
  }
  if (qp.materialId) {
    return {
      key: `m:${qp.materialId}:${qp.materialVariationId ?? ''}`,
      name: qp.material
        ? materialItemName(qp.material, qp.materialVariation)
        : qp.description || 'Material',
      type: 'Material',
    };
  }
  const name = (qp.description || '').trim() || 'Item montado';
  return { key: `c:${name.toLowerCase()}`, name, type: 'Item montado' };
}

/**
 * O nome do produto do item, como as telas e o PDF leem: o do cadastro; sem
 * produto, o do material ou a descrição do item.
 */
export const itemProductName = (qp: {
  description?: string | null;
  product?: { name?: string | null } | null;
  material?: { name: string } | null;
  materialVariation?: { brand?: string | null; color?: string | null } | null;
}) =>
  qp.product?.name ??
  (qp.material ? materialItemName(qp.material, qp.materialVariation) : null) ??
  qp.description ??
  '';
