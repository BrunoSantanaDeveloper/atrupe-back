import { Material, MaterialVariation, Prisma } from '@prisma/client';
import { marginOf, priceStatusOf } from './material-pricing';
import { UNIT_SYMBOL } from './material-text';

/** O que toda leitura de material carrega: o setor e as variações em ordem. */
export const MATERIAL_INCLUDE = Prisma.validator<Prisma.MaterialInclude>()({
  sector: { select: { name: true } },
  variations: {
    orderBy: [{ createdAt: 'asc' }, { brand: 'asc' }, { color: 'asc' }],
  },
});

export type MaterialRow = Material & {
  sector: { name: string };
  variations: MaterialVariation[];
};

export type MaterialView = {
  /** Quem lê tem `values:values:view`: sem ela, custo e preço não saem. */
  values: boolean;
  /**
   * Busca de venda direta do orçamento: só o que o vendedor precisa para
   * escolher, e nunca o custo (SEG-6, ORC-7).
   */
  directSale?: boolean;
};

const advancedOf = (material: Material) =>
  material.shape
    ? {
        shape: material.shape,
        x: material.profileX,
        y: material.profileY,
        barLength: material.barLength,
        width: material.sheetWidth,
        height: material.sheetHeight,
        wholeSheets: material.wholeSheets,
        weight: material.weight,
      }
    : null;

const moneyOf = (holder: { cost: number | null; price: number | null }) => ({
  cost: holder.cost,
  price: holder.price,
  margin: marginOf(holder.cost, holder.price),
  priceStatus: priceStatusOf(holder.cost, holder.price),
});

export function toVariationResponse(
  variation: MaterialVariation,
  view: MaterialView,
) {
  return {
    id: variation.id,
    brand: variation.brand,
    color: variation.color,
    ...(view.values ? moneyOf(variation) : {}),
  };
}

export function toMaterialResponse(material: MaterialRow, view: MaterialView) {
  if (view.directSale) {
    return {
      id: material.id,
      code: material.code,
      name: material.name,
      sector: material.sector.name,
      unit: material.unit,
      ...(view.values ? { price: material.price } : {}),
      variations: material.variations.map((variation) => ({
        id: variation.id,
        brand: variation.brand,
        color: variation.color,
        ...(view.values ? { price: variation.price } : {}),
      })),
    };
  }

  return {
    id: material.id,
    code: material.code,
    name: material.name,
    sectorId: material.sectorId,
    sector: material.sector.name,
    subcategory: material.subcategory,
    unit: material.unit,
    directSale: material.directSale,
    productionMaterial: material.productionMaterial,
    priceRule: material.priceRule,
    ...(view.values ? moneyOf(material) : {}),
    variations: material.variations.map((variation) =>
      toVariationResponse(variation, view),
    ),
    active: material.active,
    advanced: advancedOf(material),
  };
}

/**
 * O material (ou a variação) como item da Precificação: o mesmo id que a
 * composição usa para o recurso, `mat:<material>[:<variação>]`.
 */
export function toPricingItem(
  material: MaterialRow,
  variation?: MaterialVariation | null,
) {
  const holder = variation ?? material;
  return {
    id: variation ? `mat:${material.id}:${variation.id}` : `mat:${material.id}`,
    name: variation
      ? `${material.name} · ${variation.brand} ${variation.color}`.trim()
      : material.name,
    code: material.code,
    sector: material.sector.name,
    unit: UNIT_SYMBOL[material.unit],
    cost: holder.cost,
    costUpdatedAt: holder.costUpdatedAt,
    rule: material.priceRule,
    price: holder.price,
    margin: marginOf(holder.cost, holder.price),
    status: priceStatusOf(holder.cost, holder.price),
  };
}
