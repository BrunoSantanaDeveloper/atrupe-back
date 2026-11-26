import { UnitKind } from '@prisma/client';

/**
 * O fluxo de produção do produto no LITE (área 9 §4.16; Maicol, 26/11/2026).
 * As etapas de cobrança (unidades de venda) apontam o setor em que são
 * feitas: esses são os ícones fixos. Os demais ícones do fluxo são livres
 * ("também passa por…"). `productionStages` guarda a sequência inteira, na
 * ordem, com os fixos sempre ativos.
 */
export type FlowStage = { id: string; isActive: boolean };

export const parseStages = (raw: unknown): FlowStage[] => {
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value
    .filter((stage) => stage && typeof stage.id === 'string' && stage.id)
    .map((stage) => ({ id: stage.id, isActive: stage.isActive !== false }));
};

const safeParse = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Os setores das etapas de cobrança, sem repetir, na ordem das unidades. */
export const fixedSectors = (
  items: { sectorId?: string | null }[] | undefined,
): string[] => [
  ...new Set(
    (items ?? [])
      .map((item) => item.sectorId)
      .filter((id): id is string => !!id),
  ),
];

/**
 * A sequência com os fixos garantidos: o fixo que já está fica no lugar e
 * ativo; o que falta entra no fim. Os livres ficam como a pessoa deixou.
 */
export const withFixedStages = (
  stages: FlowStage[],
  fixed: string[],
): FlowStage[] => {
  const unique = Array.from(
    new Map(stages.map((stage) => [stage.id, stage])).values(),
  );
  const result = unique.map((stage) =>
    fixed.includes(stage.id) ? { id: stage.id, isActive: true } : stage,
  );
  for (const id of fixed) {
    if (!result.some((stage) => stage.id === id)) {
      result.push({ id, isActive: true });
    }
  }
  return result;
};

type QuotedUnit = {
  productItemId: string;
  quantity?: number | null;
  unitKind?: UnitKind | null;
  width?: number | null;
  height?: number | null;
  length?: number | null;
  volume?: number | null;
  weight?: number | null;
  distance?: number | null;
  duration?: number | null;
};

/**
 * A etapa de cobrança zerada no pedido (Instalação 0 h, o cliente retira):
 * sem quantidade ou sem a medida da unidade dela.
 */
export const isZeroed = (unit: QuotedUnit | undefined): boolean => {
  if (!unit) return true;
  if (!unit.quantity || unit.quantity <= 0) return true;
  const n = (value?: number | null) => Number(value) || 0;
  switch (unit.unitKind) {
    case 'AREA':
      return n(unit.width) <= 0 || n(unit.height) <= 0;
    case 'LENGTH':
      return n(unit.length) <= 0;
    case 'CAPACITY':
      return n(unit.volume) <= 0;
    case 'WEIGHT':
      return n(unit.weight) <= 0;
    case 'DISTANCE':
      return n(unit.distance) <= 0;
    case 'DURATION':
      return n(unit.duration) <= 0;
    default:
      return false;
  }
};

/**
 * Os ícones de um item do pedido: os ativos do fluxo, na ordem, menos o fixo
 * cujas etapas de cobrança ficaram todas zeradas neste pedido. `fixed` diz
 * se o ícone não pode sair do pedido.
 */
export const itemFlow = (
  stages: FlowStage[],
  units: { sectorId: string | null; zeroed: boolean }[],
): { stageId: string; fixed: boolean }[] => {
  const charged = new Set(
    units
      .filter((unit) => unit.sectorId && !unit.zeroed)
      .map((u) => u.sectorId!),
  );
  const all = new Set(
    units.filter((unit) => unit.sectorId).map((unit) => unit.sectorId!),
  );
  return withFixedStages(stages, [...all])
    .filter((stage) => stage.isActive)
    .filter((stage) => !all.has(stage.id) || charged.has(stage.id))
    .map((stage) => ({ stageId: stage.id, fixed: charged.has(stage.id) }));
};

/**
 * O setor da etapa de cobrança de um produto que nasceu sem ele (kit da
 * conta nova, importação antiga): o setor de mesmo nome que está ativo no
 * fluxo; no produto de uma unidade só, o setor do produto, se está no fluxo.
 */
export const unitSectorFromFlow = (
  unitName: string,
  units: number,
  productSectorId: string | null | undefined,
  stages: FlowStage[],
  sectors: { id: string; name: string }[],
): string | null => {
  const active = new Set(
    stages.filter((stage) => stage.isActive).map((stage) => stage.id),
  );
  const norm = (value: string) => value.trim().toLowerCase();
  const byName = sectors.find(
    (sector) => active.has(sector.id) && norm(sector.name) === norm(unitName),
  );
  if (byName) return byName.id;
  if (units === 1 && productSectorId && active.has(productSectorId)) {
    return productSectorId;
  }
  return null;
};
