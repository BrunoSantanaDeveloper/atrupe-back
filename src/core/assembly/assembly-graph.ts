import { Prisma } from '@prisma/client';
import { AssemblyResource, hourCostOf } from './assembly-resource.service';
import {
  LINE_INCLUDE,
  LineRow,
  findByName,
  toEngineLine,
} from './composition-lines';
import { orderBlocks } from './engine/compute';
import {
  EngineAssembly,
  EngineBlock,
  EngineVariation,
  Measure,
  ProductFormula,
  QuoteField,
  SaleRules,
  UnitKind,
} from './engine/types';
import { rulesByPosition, rulesOf } from './sale-rules';

/*
 * A composição do produto como o motor lê. A etapa de processo não copia as
 * linhas (CP-21): a leitura junta as linhas do processo com o que o produto
 * ajustou (linha `overridden`), acrescentou (`addedHere`), escolheu (a opção
 * da linha que acompanha) e tirou (`removedSourceLineIds`).
 */

const POSITION = [{ position: 'asc' as const }, { createdAt: 'asc' as const }];
const CREATED = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

export const SECTOR_SELECT = {
  id: true,
  name: true,
  saleUnit: true,
  hourCost: true,
  hourSale: true,
} satisfies Prisma.CompanySectorSelect;

export const LINKED_PROCESS = {
  include: {
    sector: { select: SECTOR_SELECT },
    lines: { include: LINE_INCLUDE, orderBy: POSITION },
    fields: { orderBy: CREATED },
    formulas: { orderBy: CREATED },
  },
} satisfies Prisma.ProcessDefaultArgs;

export const ASSEMBLY_INCLUDE = {
  blocks: {
    orderBy: POSITION,
    include: {
      lines: { include: LINE_INCLUDE, orderBy: POSITION },
      sector: { select: SECTOR_SELECT },
      process: LINKED_PROCESS,
    },
  },
  fields: { orderBy: CREATED },
  formulas: { orderBy: CREATED },
} satisfies Prisma.ProductAssemblyInclude;

export type AssemblyRow = Prisma.ProductAssemblyGetPayload<{
  include: typeof ASSEMBLY_INCLUDE;
}>;
export type BlockRow = AssemblyRow['blocks'][number];
export type LinkedProcess = NonNullable<BlockRow['process']>;

export const PRODUCT_SELECT = {
  id: true,
  name: true,
  code: true,
  isActive: true,
  companyId: true,
  technicalDescription: true,
  allowEditValues: true,
  allowEditDescription: true,
  // O item principal, como o GET /product/:id ordena
  items: {
    orderBy: { name: 'asc' },
    take: 1,
    select: {
      id: true,
      unitKind: true,
      unitCost: true,
      width: true,
      height: true,
      length: true,
      volume: true,
      weight: true,
      distance: true,
      duration: true,
    },
  },
  priceTiers: {
    where: { variationId: null },
    orderBy: { from: 'asc' },
    select: { from: true, unitPrice: true },
  },
  variations: {
    orderBy: POSITION,
    select: {
      id: true,
      name: true,
      unitPrice: true,
      priceTiers: {
        orderBy: { from: 'asc' },
        select: { from: true, unitPrice: true },
      },
      assemblies: { select: { id: true } },
    },
  },
} satisfies Prisma.ProductSelect;

export type ProductRow = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_SELECT;
}>;

/* --------------------------------------------------------------------------
 * O cadastro do produto: unidade, preço e medida padrão
 * ------------------------------------------------------------------------ */

/**
 * O item guarda o preço por unidade bruta (mm², mm, ml, mg, m, s) no campo
 * `unitCost` (nome antigo: é o preço de venda). A composição fala em unidade
 * comercial (m², m, l, kg, km, h).
 */
export const COMMERCIAL_FACTOR: Record<UnitKind, number> = {
  AREA: 1_000_000,
  LENGTH: 1_000,
  CAPACITY: 1_000,
  WEIGHT: 1_000_000,
  DISTANCE: 1_000,
  DURATION: 3_600,
  UNITY: 1,
  // Por folha, como a unidade (Papéis no LITE, 13/10/2026)
  SHEET: 1,
};

type MainItem = ProductRow['items'][number];

/** Quanto do item a medida padrão tem, na unidade bruta. */
export const rawAmountOf = (unitKind: UnitKind, item: MainItem) => {
  switch (unitKind) {
    case 'AREA':
      return (item.width ?? 0) * (item.height ?? 0);
    case 'LENGTH':
      return item.length ?? 0;
    case 'CAPACITY':
      return item.volume ?? 0;
    case 'WEIGHT':
      return item.weight ?? 0;
    case 'DISTANCE':
      return item.distance ?? 0;
    case 'DURATION':
      return item.duration ?? 0;
    default:
      return 1;
  }
};

export const productPricing = (product: ProductRow) => {
  const item = product.items[0];
  const unitKind = (item?.unitKind ?? 'UNITY') as UnitKind;
  const raw = item?.unitCost ?? 0;
  const area = unitKind === 'AREA';
  const amount = item ? rawAmountOf(unitKind, item) : 0;
  return {
    unitKind,
    unitPrice: raw > 0 ? Math.round(raw * COMMERCIAL_FACTOR[unitKind]) : null,
    // A medida padrão em mm; sem ela, 1 × 1 m. Largura e altura também
    // alimentam a composição do produto vendido por unidade ou por metro
    measure: {
      quantity: 1,
      width: item?.width ? item.width : 1000,
      height: item?.height ? item.height : 1000,
    },
    // Quanto de unidade comercial cada peça tem (o "Valor" do START)
    unitAmount:
      area || unitKind === 'UNITY' || !amount
        ? 1
        : amount / COMMERCIAL_FACTOR[unitKind],
  };
};

/* --------------------------------------------------------------------------
 * O vínculo com o processo (CP-21)
 * ------------------------------------------------------------------------ */

/** A linha como sai na leitura: o id é o da linha do processo, quando veio dele. */
export type MergedLine = LineRow;

/**
 * As linhas da etapa. Na etapa de processo, as do processo na ordem dele
 * (menos as tiradas), com o ajuste e a escolha deste produto; depois, as
 * acrescentadas aqui. A linha ajustada cujo processo a tirou fica como deste
 * produto.
 */
export const mergedLines = (block: BlockRow): MergedLine[] => {
  if (block.type !== 'PROCESS' || !block.process) return block.lines;

  const removed = new Set(block.removedSourceLineIds);
  const bySource = new Map(
    block.lines
      .filter((row) => row.sourceLineId)
      .map((row) => [row.sourceLineId!, row]),
  );
  const result: MergedLine[] = [];
  for (const origin of block.process.lines) {
    if (removed.has(origin.id)) continue;
    const row = bySource.get(origin.id);
    if (row?.overridden) {
      result.push({ ...row, id: origin.id, sourceLineId: origin.id });
      continue;
    }
    const chosen =
      row?.selectedOptionId &&
      origin.options.some((option) => option.id === row.selectedOptionId)
        ? row.selectedOptionId
        : origin.selectedOptionId;
    result.push({
      ...origin,
      blockId: block.id,
      sourceLineId: origin.id,
      overridden: false,
      addedHere: false,
      selectedOptionId: chosen,
    });
  }

  const sources = new Set(block.process.lines.map((line) => line.id));
  for (const row of block.lines) {
    if (!row.sourceLineId) {
      result.push({ ...row, addedHere: true });
    } else if (!sources.has(row.sourceLineId) && row.overridden) {
      result.push({
        ...row,
        sourceLineId: null,
        overridden: false,
        addedHere: true,
      });
    }
  }
  return result;
};

/** As regras da etapa: as do processo pela posição dela, e o ajuste local. */
export const blockRules = (
  block: BlockRow,
): { original: SaleRules; local: SaleRules | null } => {
  if (block.type === 'PROCESS' && block.process) {
    return {
      original: rulesByPosition(
        rulesOf(block.process.rules),
        block.process.afterBase,
        block.dependsOn,
      ),
      local: block.localRules ? rulesOf(block.localRules) : null,
    };
  }
  return { original: rulesOf(block.rules), local: null };
};

/** Os processos ligados, uma vez cada. */
export const linkedProcesses = (assembly: AssemblyRow | null) => {
  const map = new Map<string, LinkedProcess>();
  assembly?.blocks.forEach((block) => {
    if (block.process) map.set(block.process.id, block.process);
  });
  return [...map.values()];
};

export type AssemblyField = QuoteField & {
  allowsFraction: boolean;
  fromProcess: boolean;
  /** Campo do processo que o produto ainda não tem (IP-4) */
  virtual: boolean;
};

/**
 * Os campos do orçamento: os do produto, e os dos processos ligados que ele
 * ainda não tem, pelo nome (IP-4).
 */
export const assemblyFields = (
  assembly: AssemblyRow | null,
): AssemblyField[] => {
  const fields: AssemblyField[] = (assembly?.fields ?? []).map((field) => ({
    id: field.id,
    name: field.name,
    defaultValue: field.defaultValue,
    allowsFraction: field.allowsFraction,
    fromProcess: false,
    virtual: false,
  }));
  for (const process of linkedProcesses(assembly)) {
    for (const field of process.fields) {
      const own = findByName(fields, field.name);
      if (own) {
        own.fromProcess = true;
        continue;
      }
      fields.push({
        id: field.id,
        name: field.name,
        defaultValue: field.defaultValue,
        allowsFraction: field.allowsFraction,
        fromProcess: true,
        virtual: true,
      });
    }
  }
  return fields;
};

/**
 * As fórmulas: as do produto e as dos processos ligados, que só se alteram
 * no processo (CP-21).
 */
export const assemblyFormulas = (
  assembly: AssemblyRow | null,
): (ProductFormula & { processId?: string })[] => {
  const formulas: (ProductFormula & { processId?: string })[] = (
    assembly?.formulas ?? []
  ).map((formula) => ({
    id: formula.id,
    name: formula.name,
    expression: formula.expression,
  }));
  const seen = new Set(formulas.map((formula) => formula.id));
  for (const process of linkedProcesses(assembly)) {
    for (const formula of process.formulas) {
      if (seen.has(formula.id)) continue;
      seen.add(formula.id);
      formulas.push({
        id: formula.id,
        name: formula.name,
        expression: formula.expression,
        processId: process.id,
      });
    }
  }
  return formulas;
};

/* --------------------------------------------------------------------------
 * Para o motor
 * ------------------------------------------------------------------------ */

export type SectorRef = {
  id: string;
  name: string;
  saleUnit: string;
  hourCost: number | null;
  hourSale: number | null;
};

/** O setor da etapa: o dela, o do processo, ou o da primeira etapa da parte. */
export const blockSector = (
  block: BlockRow,
  partSector?: (productId: string) => SectorRef | null,
): SectorRef | null => {
  if (block.type === 'PROCESS' && block.process) return block.process.sector;
  if (block.type === 'PART' && block.partProductId) {
    return partSector?.(block.partProductId) ?? null;
  }
  return block.sector;
};

export type GraphPart = { product: ProductRow; assembly: AssemblyRow | null };

/** O que a leitura precisa de fora: as partes e os recursos. */
export type AssemblyGraph = {
  parts: Map<string, GraphPart>;
  resources: Map<string, AssemblyResource>;
};

/**
 * Monta a composição para o motor. `labor` recebe o setor de cada etapa
 * (inclusive das partes), para o preparo entrar no resumo como a mão de
 * obra dele.
 */
export class EngineBuilder {
  private readonly cache = new Map<string, EngineAssembly | null>();
  readonly labor = new Map<string, SectorRef | null>();

  constructor(private readonly graph: AssemblyGraph) {}

  partOf = (productId: string): EngineAssembly | null => {
    if (!this.cache.has(productId)) {
      // Marca antes de montar: uma parte que se inclui não entra em laço
      this.cache.set(productId, null);
      const part = this.graph.parts.get(productId);
      this.cache.set(
        productId,
        part
          ? this.build(
              part.product,
              part.assembly,
              productPricing(part.product).measure,
            )
          : null,
      );
    }
    return this.cache.get(productId) ?? null;
  };

  private partSector = (productId: string): SectorRef | null => {
    const part = this.graph.parts.get(productId);
    if (!part?.assembly?.blocks.length) return null;
    const first = orderBlocks(part.assembly.blocks)[0];
    return blockSector(first, this.partSector);
  };

  build(
    product: ProductRow,
    assembly: AssemblyRow | null,
    measureMm: Measure,
  ): EngineAssembly {
    const pricing = productPricing(product);
    const ids = new Set(assembly?.blocks.map((block) => block.id));
    const blocks: EngineBlock[] = (assembly?.blocks ?? []).map((block) => {
      const sector = blockSector(block, this.partSector);
      this.labor.set(block.id, sector);
      const rules = blockRules(block);
      const dependsOn = block.dependsOn.filter((id) => ids.has(id));
      return {
        id: block.id,
        processId: block.type === 'PROCESS' ? block.processId : null,
        name:
          block.type === 'PROCESS' && block.process
            ? block.process.name
            : block.name,
        ...(block.type === 'PROCESS' && block.localName
          ? { localName: block.localName }
          : {}),
        ...(block.type === 'PART' && block.partProductId
          ? { partProductId: block.partProductId }
          : {}),
        sector: sector?.name ?? '',
        dependsOn,
        baseBlockId:
          block.baseBlockId && ids.has(block.baseBlockId)
            ? block.baseBlockId
            : (dependsOn[0] ?? null),
        setupMinutes:
          block.type === 'PROCESS' && block.process
            ? block.process.setupMinutes
            : block.type === 'PART'
              ? 0
              : block.setupMinutes,
        sectorHourCost: hourCostOf(this.graph.resources, sector),
        sectorHourSale: sector?.hourSale ?? 0,
        originalRules: rules.original,
        localRules: rules.local,
        lines:
          block.type === 'PART'
            ? []
            : mergedLines(block).map((line) =>
                toEngineLine(line, this.graph.resources),
              ),
        ...(block.type === 'PROCESS' && block.process && !block.process.isActive
          ? { processInactive: true }
          : {}),
      };
    });

    return {
      productId: product.id,
      name: product.name,
      unitKind: pricing.unitKind,
      unitPrice: pricing.unitPrice,
      measure: {
        quantity: measureMm.quantity,
        width: measureMm.width / 1000,
        height: measureMm.height / 1000,
      },
      unitAmount: pricing.unitAmount,
      priceTiers: product.priceTiers,
      blocks,
      fields: assemblyFields(assembly),
      formulas: assemblyFormulas(assembly),
      ...(product.isActive ? {} : { inactive: true }),
    };
  }
}

/** A variação para o motor: o preço dela e a tabela própria, se houver. */
export const engineVariation = (
  variation: ProductRow['variations'][number] | undefined,
): EngineVariation | null =>
  variation
    ? {
        id: variation.id,
        name: variation.name,
        unitPrice: variation.unitPrice,
        priceTiers: variation.priceTiers.length ? variation.priceTiers : null,
      }
    : null;

/** Os produtos usados como parte nesta composição. */
export const partIdsOf = (assembly: AssemblyRow | null) =>
  (assembly?.blocks ?? [])
    .filter((block) => block.type === 'PART' && block.partProductId)
    .map((block) => block.partProductId!);
