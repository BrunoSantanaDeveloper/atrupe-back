import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from 'nestjs-prisma';
import { omitMoneyFields } from '../auth/abac/values-visibility.interceptor';
import { PricingParametersService } from '../pricing/pricing-parameters.service';
import {
  ASSEMBLY_INCLUDE,
  AssemblyField,
  AssemblyGraph,
  AssemblyRow,
  BlockRow,
  COMMERCIAL_FACTOR,
  EngineBuilder,
  GraphPart,
  PRODUCT_SELECT,
  ProductRow,
  assemblyFields,
  assemblyFormulas,
  blockRules,
  blockSector,
  engineVariation,
  mergedLines,
  partIdsOf,
  productPricing,
  rawAmountOf,
} from './assembly-graph';
import { AssemblyResourceService } from './assembly-resource.service';
import {
  ASSEMBLY_MONEY_FIELDS,
  lineView,
  measureMm,
  summaryView,
} from './assembly-view';
import {
  FIELD_IN_USE,
  FIELD_NOT_FOUND,
  FORMULA_IN_USE,
  FORMULA_NOT_FOUND,
  LINE_INCLUDE,
  LINE_NOT_FOUND,
  LineRow,
  findByName,
  systemNameCheck,
  integerCheck,
  lineUpdateData,
  newLineData,
  newOptionData,
  removeOptionData,
} from './composition-lines';
import {
  AssemblyQueryDto,
  CreateAssemblyVariationDto,
  CreateBlockDto,
  NextStepQueryDto,
  PartCandidateQueryDto,
  ProductCreateFieldDto,
  ProductCreateFormulaDto,
  ProductCreateLineDto,
  ProductCreateOptionDto,
  ProductUpdateFieldDto,
  ProductUpdateFormulaDto,
  ProductUpdateLineDto,
  UpdateAssemblyDto,
  UpdateBlockDto,
} from './dto/assembly.dto';
import {
  computeAssembly,
  fieldsWithImplied,
  formulaVars,
} from './engine/compute';
import {
  evaluateFormula,
  formulaUsesName,
  normalizeName,
} from './engine/formula';
import {
  ComputedAssembly,
  EngineVariation,
  Measure,
  SaleRules,
} from './engine/types';
import { BASE_RULES, FINISHING_RULES, mergeRules, rulesOf } from './sale-rules';

export const PRODUCT_NOT_FOUND = 'Produto não encontrado';
export const VARIATION_NOT_FOUND = 'Variação não encontrada';
export const BLOCK_NOT_FOUND = 'Etapa não encontrada';
export const DRAFT_NOT_FOUND = 'Item montado não encontrado';
const PROCESS_NOT_FOUND = 'Processo não encontrado';
const OWN_ASSEMBLY_REQUIRED =
  'Esta variação usa a composição padrão: crie a composição própria dela primeiro';
const FIELD_FROM_PROCESS = 'Este campo vem do processo: altere-o no processo';
const FORMULA_FROM_PROCESS =
  'Esta fórmula vem do processo: altere-a no processo';
/** Partes dentro de partes: até três níveis (IP-9) */
const MAX_PART_LEVELS = 3;
/** Teto de itens por página (SEG-2) */
const PAGE_LIMIT = 100;

type Ctx = {
  companyId: string;
  productId: string;
  variationId?: string | null;
  /**
   * O rascunho do item montado no orçamento (ORC-11): o dono da composição
   * no lugar do produto. `productId` traz o mesmo id.
   */
  draftId?: string | null;
};

/** O produto da composição, ou o sintético do rascunho do orçamento. */
export type OwnerRow = ProductRow & { draftId?: string };

/** Onde está a composição: no produto ou no rascunho. */
const ownerWhere = (owner: OwnerRow) =>
  owner.draftId ? { draftId: owner.draftId } : { productId: owner.id };

/**
 * O rascunho como produto para o motor (ORC-11): vendido por unidade, na
 * medida do rascunho, sem preço de cadastro, faixas nem variações. O preço
 * do item é a soma das etapas (o sugerido).
 */
export const draftOwner = (draft: {
  id: string;
  companyId: string;
  name: string;
  width: number;
  height: number;
}): OwnerRow => ({
  id: draft.id,
  name: draft.name,
  code: '',
  isActive: true,
  companyId: draft.companyId,
  technicalDescription: '',
  allowEditValues: true,
  allowEditDescription: true,
  items: [
    {
      id: draft.id,
      unitKind: 'UNITY',
      unitCost: null,
      width: draft.width,
      height: draft.height,
      length: null,
      volume: null,
      weight: null,
      distance: null,
      duration: null,
    },
  ],
  priceTiers: [],
  variations: [],
  draftId: draft.id,
});

type ResolvedLine =
  | { kind: 'own'; row: LineRow }
  | { kind: 'process'; origin: LineRow; row: LineRow | undefined };

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const jsonOrNull = (value: unknown) =>
  value === null || value === undefined
    ? Prisma.DbNull
    : (value as Prisma.InputJsonValue);

/** O nome da etapa como a tela mostra. */
const stageName = (block: BlockRow) =>
  block.localName || block.process?.name || block.name;

const sameRules = (a: SaleRules, b: SaleRules) =>
  JSON.stringify(rulesOf(a)) === JSON.stringify(rulesOf(b));

/** Seguindo as dependências, `from` chega em `target`? (impede laço, FL-5) */
const dependsTransitively = (
  blocks: { id: string; dependsOn: string[] }[],
  from: string,
  target: string,
  seen = new Set<string>(),
): boolean => {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const block = blocks.find((item) => item.id === from);
  return !!block?.dependsOn.some((id) =>
    dependsTransitively(blocks, id, target, seen),
  );
};

/**
 * A composição do produto (CP-17): etapas montadas ali, preenchidas por um
 * processo (vínculo CP-21) ou por outro produto (parte, IP-9), com o cálculo
 * no servidor (SEG-1). Contrato da API, módulo 1, parte A.
 */
@Injectable()
export class ProductAssemblyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: AssemblyResourceService,
    private readonly pricing: PricingParametersService,
  ) {}

  /* ================================================================ leitura */

  async read(ctx: Ctx, query: AssemblyQueryDto, options: { values: boolean }) {
    const product = await this.product(ctx);
    const variation = this.variationOf(product, query.variationId);
    const all = await this.prisma.productAssembly.findMany({
      where: { ...ownerWhere(product), companyId: ctx.companyId },
      include: ASSEMBLY_INCLUDE,
    });
    const assemblyOf = (variationId: string | null) =>
      all.find((item) => item.variationKey === (variationId ?? '')) ?? null;
    const ownKey = variation?.assemblies.length ? variation.id : null;
    const assembly = assemblyOf(ownKey);

    const pricing = productPricing(product);
    const measure = {
      quantity: query.quantity ?? pricing.measure.quantity,
      width: query.width ?? pricing.measure.width,
      height: query.height ?? pricing.measure.height,
    };
    const graph = await this.loadGraph(ctx.companyId, all);
    const markup = await this.pricing.referenceMarkupOf(ctx.companyId);
    const builder = new EngineBuilder(graph);
    const run = (
      target: AssemblyRow | null,
      engineVar: EngineVariation | null,
      at: Measure,
    ) => this.compute(builder, graph, markup, product, target, engineVar, at);

    const computed = run(assembly, engineVariation(variation), measure);

    // Cada faixa recalculada na quantidade dela (FQ-3), pelo custo por
    // unidade comercial
    const tierSummary = [...computed.effectiveTiers]
      .sort((a, b) => a.from - b.from)
      .map((tier) => {
        const at = run(assembly, engineVariation(variation), {
          ...measure,
          quantity: tier.from,
        });
        const unitCost = at.cost / Math.max(at.saleAmount, 0.0001);
        return {
          from: tier.from,
          unitPrice: tier.unitPrice,
          unitCost: Math.round(unitCost * 100) / 100,
          margin: tier.unitPrice
            ? Math.round(
                ((tier.unitPrice - unitCost) / tier.unitPrice) * 1000,
              ) / 10
            : null,
        };
      });

    // A padrão e cada variação na mesma medida (PV-4)
    const variationSummary = [null, ...product.variations].map((item) => {
      const target = item?.assemblies.length
        ? assemblyOf(item.id)
        : assemblyOf(null);
      const at = run(target, engineVariation(item ?? undefined), measure);
      return {
        id: item?.id ?? null,
        name: item?.name ?? 'Padrão',
        cost: at.cost,
        priceForMeasure: at.priceForMeasure,
        margin: at.margin,
      };
    });

    const view = {
      ...this.assemblyView(product, assembly, computed, builder, markup),
      variationId: variation?.id ?? null,
      hasOwnAssembly: !!ownKey,
      tierSummary,
      variationSummary,
    };
    if (options.values) return view;
    const hidden = omitMoneyFields(view, ASSEMBLY_MONEY_FIELDS);
    delete (hidden as Partial<typeof view>).tierSummary;
    delete (hidden as Partial<typeof view>).variationSummary;
    return hidden;
  }

  /** Os processos para "nova etapa depois de…" (FL-7): os usuais primeiro. */
  async nextStep(ctx: Ctx, query: NextStepQueryDto) {
    const product = await this.product(ctx);
    const variation = this.variationOf(product, query.variationId);
    const processes = await this.prisma.process.findMany({
      where: { companyId: ctx.companyId, isActive: true },
      select: {
        id: true,
        name: true,
        sectorId: true,
        afterBase: true,
        sellerInstructions: true,
        sector: { select: { name: true } },
      },
    });
    const all = processes
      .map((process) => ({
        id: process.id,
        name: process.name,
        sectorId: process.sectorId,
        sector: process.sector.name,
        afterBase: process.afterBase,
        sellerInstructions: process.sellerInstructions || null,
      }))
      .sort(
        (a, b) =>
          a.sector.localeCompare(b.sector, 'pt-BR') ||
          a.name.localeCompare(b.name, 'pt-BR'),
      );
    if (!query.blockId) return { usual: [], all };

    const block = await this.prisma.assemblyBlock.findFirst({
      where: {
        id: query.blockId,
        assembly: {
          ...ownerWhere(product),
          variationKey: variation?.assemblies.length ? variation.id : '',
        },
      },
      select: { processId: true },
    });
    if (!block?.processId) return { usual: [], all };
    const pairs = await this.prisma.processUsualNext.findMany({
      where: { fromProcessId: block.processId },
      select: { toProcessId: true },
    });
    const usual = new Set(pairs.map((pair) => pair.toProcessId));
    return { usual: all.filter((item) => usual.has(item.id)), all };
  }

  /**
   * Os produtos que podem entrar como parte (IP-9): ativos, com etapas, que
   * não são este nem o contêm. Os marcados como parte vêm primeiro.
   */
  async partCandidates(ctx: Ctx, query: PartCandidateQueryDto) {
    const product = await this.product(ctx);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, PAGE_LIMIT);
    const containers = await this.containersOf(ctx.companyId, product.id);
    const search = query.search?.trim();
    const rows = await this.prisma.productAssembly.findMany({
      where: {
        companyId: ctx.companyId,
        variationKey: '',
        blocks: { some: {} },
        product: {
          isActive: true,
          id: { notIn: [product.id, ...containers] },
          ...(search
            ? { name: { contains: search, mode: 'insensitive' } }
            : {}),
        },
      },
      select: {
        productId: true,
        status: true,
        product: { select: { name: true, code: true } },
        _count: { select: { blocks: true } },
      },
    });
    const data = rows
      .map((row) => ({
        productId: row.productId,
        name: row.product.name,
        code: row.product.code,
        status: row.status,
        stages: row._count.blocks,
      }))
      .sort(
        (a, b) =>
          Number(b.status === 'PART') - Number(a.status === 'PART') ||
          a.name.localeCompare(b.name, 'pt-BR'),
      );
    return {
      data: data.slice((page - 1) * limit, page * limit),
      page,
      lastPage: Math.max(1, Math.ceil(data.length / limit)),
      total: data.length,
    };
  }

  /* ============================================================== cabeçalho */

  async updateHeader(ctx: Ctx, dto: UpdateAssemblyDto) {
    const { product, assembly } = await this.writable(ctx);
    if (dto.status === 'RELEASED') {
      if (!assembly.blocks.length) {
        bad('Monte a composição antes de liberar o produto para venda');
      }
      const open = assembly.blocks.some((block) =>
        mergedLines(block).some(
          (line) =>
            line.mode === 'CHOOSE' &&
            line.options.length > 0 &&
            !line.selectedOptionId,
        ),
      );
      if (open) {
        bad('Há linhas de escolha sem opção padrão. Escolha antes de liberar');
      }
      await this.ensureCode(product);
    }
    const updated = await this.prisma.productAssembly.update({
      where: { id: assembly.id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.dimension ? { dimension: dto.dimension } : {}),
        ...(dto.allowRenameStages !== undefined
          ? { allowRenameStages: dto.allowRenameStages }
          : {}),
      },
      select: { status: true, dimension: true, allowRenameStages: true },
    });
    return { productId: ctx.productId, ...updated };
  }

  /**
   * O produto salvo do item montado nasce sem código (ORC-11): ao liberar a
   * composição para venda, ganha o próximo "MONT-nn" livre da empresa
   * (PO, 14/10/2026), que pode ser trocado no cadastro.
   */
  private async ensureCode(product: OwnerRow) {
    if (product.draftId || product.code) return;
    const taken = await this.prisma.product.findMany({
      where: { companyId: product.companyId, code: { startsWith: 'MONT-' } },
      select: { code: true },
    });
    const numbers = taken
      .map((row) => Number(row.code?.slice(5)))
      .filter((value) => Number.isInteger(value));
    const next = Math.max(0, ...numbers) + 1;
    await this.prisma.product.update({
      where: { id: product.id },
      data: { code: `MONT-${String(next).padStart(2, '0')}` },
    });
  }

  /**
   * Adota o preço sugerido na medida padrão (CP-16, DC-14): no valor de venda
   * do cadastro, ou no preço da variação. O valor é do servidor, não do corpo.
   */
  async adoptSuggestedPrice(ctx: Ctx) {
    const product = await this.product(ctx);
    const variation = this.variationOf(product, ctx.variationId);
    const all = await this.prisma.productAssembly.findMany({
      where: { productId: product.id, companyId: ctx.companyId },
      include: ASSEMBLY_INCLUDE,
    });
    const key = variation?.assemblies.length ? variation.id : '';
    const assembly = all.find((item) => item.variationKey === key) ?? null;
    const graph = await this.loadGraph(ctx.companyId, all);
    const markup = await this.pricing.referenceMarkupOf(ctx.companyId);
    const computed = this.compute(
      new EngineBuilder(graph),
      graph,
      markup,
      product,
      assembly,
      engineVariation(variation),
      productPricing(product).measure,
    );
    if (!computed.cost) bad('Produto sem custo calculado');
    const unitPrice = computed.suggestedUnitPrice;

    if (variation) {
      await this.prisma.productVariation.update({
        where: { id: variation.id },
        data: { unitPrice },
      });
    } else {
      const item = product.items[0];
      if (!item) bad('Produto sem custo calculado');
      const pricing = productPricing(product);
      const raw = unitPrice / COMMERCIAL_FACTOR[pricing.unitKind];
      await this.prisma.productItem.update({
        where: { id: item.id },
        data: {
          unitCost: raw,
          salePrice: raw * rawAmountOf(pricing.unitKind, item),
        },
      });
    }
    return {
      productId: product.id,
      variationId: variation?.id ?? null,
      unitPrice,
    };
  }

  /**
   * O custo e os preços do produto na medida padrão, por unidade comercial,
   * sem gravar nada: a precificação lê daqui (grupo produtos). Sem
   * composição, nulo (custo não calculado, DC-15).
   */
  async standardPricing(companyId: string, productId: string) {
    const product = await this.product({ companyId, productId });
    const all = await this.prisma.productAssembly.findMany({
      where: { productId: product.id, companyId },
      include: ASSEMBLY_INCLUDE,
    });
    const assembly = all.find((item) => item.variationKey === '') ?? null;
    if (!assembly?.blocks.length) return null;
    const graph = await this.loadGraph(companyId, all);
    const markup = await this.pricing.referenceMarkupOf(companyId);
    const pricing = productPricing(product);
    const computed = this.compute(
      new EngineBuilder(graph),
      graph,
      markup,
      product,
      assembly,
      null,
      pricing.measure,
    );
    return {
      unitKind: pricing.unitKind,
      unitCost: computed.cost
        ? Math.round(computed.cost / Math.max(computed.saleAmount, 0.0001))
        : null,
      suggestedUnitPrice: computed.suggestedUnitPrice,
      unitPrice: pricing.unitPrice,
    };
  }

  /* ================================================================ etapas */

  async addBlock(ctx: Ctx, dto: CreateBlockDto) {
    const { product, assembly } = await this.writable(ctx);
    const ids = new Set(assembly.blocks.map((block) => block.id));
    const dependsOn = [...new Set(dto.dependsOn ?? [])];
    if (dependsOn.some((id) => !ids.has(id))) bad(BLOCK_NOT_FOUND);
    if (dto.insertBefore && !ids.has(dto.insertBefore)) bad(BLOCK_NOT_FOUND);

    const base = {
      id: randomUUID(),
      assemblyId: assembly.id,
      dependsOn,
      baseBlockId: dependsOn[0] ?? null,
      position:
        assembly.blocks.reduce((max, b) => Math.max(max, b.position), -1) + 1,
    };
    let data: Prisma.AssemblyBlockUncheckedCreateInput;

    if (dto.type === 'PROCESS') {
      const process = dto.processId
        ? await this.prisma.process.findFirst({
            where: {
              id: dto.processId,
              companyId: ctx.companyId,
              isActive: true,
            },
            select: { id: true },
          })
        : null;
      if (!process) throw new NotFoundException(PROCESS_NOT_FOUND);
      data = { ...base, type: 'PROCESS', processId: process.id };
    } else if (dto.type === 'OWN') {
      const name = dto.name?.trim();
      if (!name) bad('Informe o nome da etapa');
      const sector = dto.sectorId
        ? await this.prisma.companySector.findFirst({
            where: {
              id: dto.sectorId,
              companyId: ctx.companyId,
              isActive: true,
            },
            select: { id: true, name: true },
          })
        : null;
      if (!sector) bad('Escolha um setor ativo');
      data = {
        ...base,
        type: 'OWN',
        name: name!,
        sectorId: sector!.id,
        taskType: sector!.name,
        // Com dependência, nasce com as regras de acabamento (FL-2, MS-5)
        rules: { ...(dependsOn.length ? FINISHING_RULES : BASE_RULES) },
      };
    } else {
      const part = dto.partProductId
        ? await this.prisma.product.findFirst({
            where: { id: dto.partProductId, companyId: ctx.companyId },
            select: {
              id: true,
              name: true,
              isActive: true,
              assemblies: {
                where: { variationKey: '' },
                select: { _count: { select: { blocks: true } } },
              },
            },
          })
        : null;
      if (!part || !part.assemblies[0]?._count.blocks) {
        bad('Parte sem composição');
      }
      const containers = await this.containersOf(ctx.companyId, product.id);
      if (part!.id === product.id || containers.includes(part!.id)) {
        bad('Um produto não pode ser parte dele mesmo');
      }
      if (!part!.isActive) bad('Produto inativo não entra como parte');
      data = {
        ...base,
        type: 'PART',
        partProductId: part!.id,
        name: part!.name,
        // A parte acompanha a medida e a quantidade do produto por padrão
        rules: { ...(dependsOn.length ? FINISHING_RULES : BASE_RULES) },
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.assemblyBlock.create({ data });
      // Inserir no meio da ligação (FL-5): a etapa seguinte passa a depender
      // da nova
      if (dto.insertBefore) {
        const next = assembly.blocks.find((b) => b.id === dto.insertBefore)!;
        const replaced = dependsOn.filter((id) => next.dependsOn.includes(id));
        if (replaced.length) {
          await tx.assemblyBlock.update({
            where: { id: next.id },
            data: {
              dependsOn: [
                ...new Set(
                  next.dependsOn.map((id) =>
                    replaced.includes(id) ? base.id : id,
                  ),
                ),
              ],
              ...(next.baseBlockId && replaced.includes(next.baseBlockId)
                ? { baseBlockId: base.id }
                : {}),
            },
          });
        }
      }
    });
    return { id: base.id };
  }

  async updateBlock(ctx: Ctx, blockId: string, dto: UpdateBlockDto) {
    const { assembly } = await this.writable(ctx);
    const block = this.findBlock(assembly, blockId);
    const data: Prisma.AssemblyBlockUncheckedUpdateInput = {};
    const isProcess = block.type === 'PROCESS' && !!block.process;

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) bad('Informe o nome da etapa');
      if (isProcess) {
        data.localName = name === block.process!.name ? null : name;
      } else {
        data.name = name;
      }
    }
    if (dto.taskType?.trim()) {
      const taskType = dto.taskType.trim();
      if (isProcess) {
        data.localTaskType =
          taskType === block.process!.taskType ? null : taskType;
      } else {
        data.taskType = taskType;
      }
    }

    let dependsOn = block.dependsOn;
    if (dto.dependsOn !== undefined) {
      dependsOn = [...new Set(dto.dependsOn)];
      const others = new Map(assembly.blocks.map((b) => [b.id, b]));
      for (const id of dependsOn) {
        if (id === block.id) bad('A etapa não pode depender dela mesma');
        const target = others.get(id);
        if (!target) bad(BLOCK_NOT_FOUND);
        if (dependsTransitively(assembly.blocks, id, block.id)) {
          bad(
            `${stageName(target!)} já vem depois de ${stageName(block)}: ligar as duas fecharia um laço`,
          );
        }
      }
      data.dependsOn = dependsOn;
      // A base fica se continuar na lista; senão, vira a primeira
      data.baseBlockId =
        block.baseBlockId && dependsOn.includes(block.baseBlockId)
          ? block.baseBlockId
          : (dependsOn[0] ?? null);
    }

    if (dto.processId !== undefined) {
      const process = await this.prisma.process.findFirst({
        where: { id: dto.processId, companyId: ctx.companyId, isActive: true },
        select: { id: true },
      });
      if (!process) throw new NotFoundException(PROCESS_NOT_FOUND);
      // Trocar o processo (FL-6): mesmo id e ligações; as linhas passam a
      // ser as do processo novo
      Object.assign(data, {
        type: 'PROCESS',
        processId: process.id,
        partProductId: null,
        localName: null,
        localTaskType: null,
        localRules: Prisma.DbNull,
        removedSourceLineIds: [],
      });
    }

    if (dto.rules !== undefined && dto.processId === undefined) {
      if (isProcess) {
        if (dto.rules === null) {
          data.localRules = Prisma.DbNull;
        } else {
          const position = blockRules({ ...block, dependsOn }).original;
          const current = block.localRules
            ? rulesOf(block.localRules)
            : position;
          const next = mergeRules(current, dto.rules);
          data.localRules = sameRules(next, position)
            ? Prisma.DbNull
            : { ...next };
        }
      } else if (dto.rules) {
        data.rules = { ...mergeRules(rulesOf(block.rules), dto.rules) };
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.processId !== undefined) {
        await tx.assemblyLine.deleteMany({ where: { blockId: block.id } });
      }
      await tx.assemblyBlock.update({ where: { id: block.id }, data });
    });
    return { id: block.id };
  }

  /** Tira a etapa sem soltar o fluxo (FL-12). */
  async removeBlock(ctx: Ctx, blockId: string) {
    const { assembly } = await this.writable(ctx);
    const removed = this.findBlock(assembly, blockId);
    await this.prisma.$transaction(async (tx) => {
      for (const block of assembly.blocks) {
        if (!block.dependsOn.includes(removed.id)) continue;
        await tx.assemblyBlock.update({
          where: { id: block.id },
          data: {
            dependsOn: [
              ...new Set([
                ...block.dependsOn.filter((id) => id !== removed.id),
                ...removed.dependsOn,
              ]),
            ],
            baseBlockId:
              block.baseBlockId === removed.id
                ? (removed.baseBlockId ?? removed.dependsOn[0] ?? null)
                : block.baseBlockId,
          },
        });
      }
      await tx.assemblyBlock.delete({ where: { id: removed.id } });
    });
  }

  async restoreProcessLines(ctx: Ctx, blockId: string) {
    const { assembly } = await this.writable(ctx);
    const block = this.findBlock(assembly, blockId);
    if (block.type !== 'PROCESS' || !block.process) {
      throw new NotFoundException(BLOCK_NOT_FOUND);
    }
    const sources = new Set(block.process.lines.map((line) => line.id));
    const restored = block.removedSourceLineIds.filter((id) =>
      sources.has(id),
    ).length;
    await this.prisma.assemblyBlock.update({
      where: { id: block.id },
      data: { removedSourceLineIds: [] },
    });
    return { id: block.id, restored };
  }

  /* ================================================================ linhas */

  async addLine(ctx: Ctx, blockId: string, dto: ProductCreateLineDto) {
    const { assembly } = await this.writable(ctx);
    const block = this.findBlock(assembly, blockId);
    if (block.type === 'PART') {
      bad('A parte não tem linhas próprias: ajuste a composição dela');
    }
    const { line, options } = newLineData(dto, {
      resources: await this.resources.resolve(ctx.companyId, dto.resourceIds),
      sectorSaleUnit: blockSector(block)?.saleUnit ?? 'HOUR',
      formulaIds: this.formulaIds(assembly),
    });
    await this.prisma.$transaction(async (tx) => {
      const fieldName = line.fieldName
        ? await this.ensureField(tx, assembly, line.fieldName, dto.fieldDefault)
        : null;
      await tx.assemblyLine.create({
        data: {
          ...line,
          fieldName,
          blockId: block.id,
          // Numa etapa vinda de processo, a linha a mais é só deste produto
          addedHere: block.type === 'PROCESS',
          position:
            block.lines.reduce((max, row) => Math.max(max, row.position), -1) +
            1,
          options: { create: options },
        },
      });
    });
    return { id: line.id };
  }

  async updateLine(
    ctx: Ctx,
    blockId: string,
    lineId: string,
    dto: ProductUpdateLineDto,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { variationId, ...body } = dto;
    const { assembly } = await this.writable(ctx);
    const block = this.findBlock(assembly, blockId);
    const target = this.resolveLine(block, lineId);
    const formulaIds = this.formulaIds(assembly);

    if (target.kind === 'own') {
      const { data, optionUpdates } = lineUpdateData(target.row, body, {
        formulaIds,
      });
      await this.applyLineUpdate(
        assembly,
        target.row.id,
        data,
        optionUpdates,
        body,
      );
      return { id: lineId, overridden: false };
    }

    // Trocar só a opção escolhida é uso normal: a linha segue o processo
    if (!target.row?.overridden) {
      const current = {
        ...target.origin,
        selectedOptionId:
          target.row?.selectedOptionId ?? target.origin.selectedOptionId,
      };
      const { data, onlyChoice } = lineUpdateData(current, body, {
        formulaIds,
      });
      if (onlyChoice) {
        await this.saveChoice(
          block,
          target,
          (data.selectedOptionId as string | null | undefined) ?? null,
        );
        return { id: lineId, overridden: false };
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const { row, optionMap } = await this.overridden(tx, block, target);
      const mapId = (id: string) => optionMap.get(id) ?? id;
      const mapped = {
        ...body,
        ...(body.selectedId !== undefined
          ? { selectedId: body.selectedId ? mapId(body.selectedId) : '' }
          : {}),
        ...(body.optionValues
          ? {
              optionValues: body.optionValues.map((value) => ({
                ...value,
                id: mapId(value.id),
              })),
            }
          : {}),
      };
      const { data, optionUpdates } = lineUpdateData(row, mapped, {
        formulaIds,
      });
      await this.applyLineUpdate(
        assembly,
        row.id,
        data,
        optionUpdates,
        body,
        tx,
      );
    });
    return { id: lineId, overridden: true };
  }

  /** "Voltar a acompanhar o processo": desfaz o ajuste local (CP-21). */
  async resetLine(ctx: Ctx, blockId: string, lineId: string) {
    const { assembly } = await this.writable(ctx);
    const block = this.findBlock(assembly, blockId);
    const target = this.resolveLine(block, lineId);
    if (target.kind !== 'process') throw new NotFoundException(LINE_NOT_FOUND);
    if (target.row) {
      await this.prisma.assemblyLine.delete({ where: { id: target.row.id } });
    }
    return { id: lineId, overridden: false };
  }

  async removeLine(ctx: Ctx, blockId: string, lineId: string) {
    const { assembly } = await this.writable(ctx);
    const block = this.findBlock(assembly, blockId);
    const target = this.resolveLine(block, lineId);
    await this.prisma.$transaction(async (tx) => {
      if (target.kind === 'process') {
        // Tirada só deste produto: não volta quando o processo muda
        await tx.assemblyBlock.update({
          where: { id: block.id },
          data: {
            removedSourceLineIds: [
              ...new Set([...block.removedSourceLineIds, target.origin.id]),
            ],
          },
        });
        if (target.row) {
          await tx.assemblyLine.delete({ where: { id: target.row.id } });
        }
      } else {
        await tx.assemblyLine.delete({ where: { id: target.row.id } });
      }
    });
  }

  async addOption(
    ctx: Ctx,
    blockId: string,
    lineId: string,
    dto: ProductCreateOptionDto,
  ) {
    const { assembly } = await this.writable(ctx);
    const block = this.findBlock(assembly, blockId);
    const target = this.resolveLine(block, lineId);
    const source = target.kind === 'own' ? target.row : target.origin;
    const resources = await this.resources.resolve(ctx.companyId, [
      ...source.options.map((option) => option.resourceId),
      ...(target.row?.options.map((option) => option.resourceId) ?? []),
      dto.resourceId,
    ]);
    const sectorSaleUnit = blockSector(block)?.saleUnit ?? 'HOUR';
    // Confere antes de copiar a linha do processo
    newOptionData(
      target.kind === 'own' || target.row?.overridden ? target.row! : source,
      dto,
      { resources, sectorSaleUnit },
    );

    const id = await this.prisma.$transaction(async (tx) => {
      const row =
        target.kind === 'own'
          ? target.row
          : (await this.overridden(tx, block, target)).row;
      const { option, selectedOptionId } = newOptionData(row, dto, {
        resources,
        sectorSaleUnit,
      });
      await tx.assemblyLineOption.create({
        data: { ...option, lineId: row.id },
      });
      if (selectedOptionId) {
        await tx.assemblyLine.update({
          where: { id: row.id },
          data: { selectedOptionId },
        });
      }
      return option.id;
    });
    return { id };
  }

  async removeOption(
    ctx: Ctx,
    blockId: string,
    lineId: string,
    optionId: string,
  ) {
    const { assembly } = await this.writable(ctx);
    const block = this.findBlock(assembly, blockId);
    const target = this.resolveLine(block, lineId);
    const current =
      target.kind === 'own' || target.row?.overridden
        ? target.row!
        : target.origin;
    // Confere antes de copiar a linha do processo
    removeOptionData(current, optionId);

    await this.prisma.$transaction(async (tx) => {
      let row = current;
      let id = optionId;
      if (target.kind === 'process' && !target.row?.overridden) {
        const copy = await this.overridden(tx, block, target);
        row = copy.row;
        id = copy.optionMap.get(optionId) ?? optionId;
      }
      const { selectedOptionId } = removeOptionData(row, id);
      await tx.assemblyLineOption.delete({ where: { id } });
      if (selectedOptionId) {
        await tx.assemblyLine.update({
          where: { id: row.id },
          data: { selectedOptionId },
        });
      }
    });
  }

  /* ==================================================== campos do orçamento */

  async addField(ctx: Ctx, dto: ProductCreateFieldDto) {
    const { assembly } = await this.writable(ctx);
    const name = dto.name.trim();
    if (!name) bad('Informe o nome do campo');
    systemNameCheck(name);
    if (findByName(assemblyFields(assembly), name)) {
      bad('Já existe um campo com esse nome neste produto');
    }
    const allowsFraction = dto.allowsFraction ?? false;
    const defaultValue = dto.defaultValue ?? 0;
    integerCheck({ name, allowsFraction }, defaultValue);
    const field = await this.prisma.assemblyField.create({
      data: { assemblyId: assembly.id, name, defaultValue, allowsFraction },
    });
    return { ...this.fieldView(assembly, field), fromProcess: false };
  }

  async updateField(ctx: Ctx, fieldId: string, dto: ProductUpdateFieldDto) {
    const { assembly } = await this.writable(ctx);
    const fields = assemblyFields(assembly);
    const field = fields.find((item) => item.id === fieldId);
    if (!field) throw new NotFoundException(FIELD_NOT_FOUND);

    let allowsFraction = field.allowsFraction;
    let defaultValue = field.defaultValue;
    if (dto.allowsFraction !== undefined) {
      allowsFraction = dto.allowsFraction;
      // Voltando a inteiro, o padrão com fração é arredondado
      if (!allowsFraction) defaultValue = Math.round(defaultValue);
    }
    if (dto.defaultValue !== undefined) {
      integerCheck({ name: field.name, allowsFraction }, dto.defaultValue);
      defaultValue = dto.defaultValue;
    }
    let name = field.name;
    if (dto.name !== undefined) {
      name = dto.name.trim();
      if (!name) bad('Informe o nome do campo');
      systemNameCheck(name, field.name);
      const other = findByName(fields, name);
      if (other && other.id !== field.id) {
        bad('Já existe um campo com esse nome neste produto');
      }
      // O processo lê o campo pelo nome: renomear seria perder a ligação
      if (name !== field.name && field.fromProcess) bad(FIELD_FROM_PROCESS);
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      // O campo do processo vira deste produto com o valor ajustado (IP-4)
      if (field.virtual) {
        return tx.assemblyField.create({
          data: { assemblyId: assembly.id, name, defaultValue, allowsFraction },
        });
      }
      if (name !== field.name) {
        const ids = assembly.blocks
          .flatMap((block) => block.lines)
          .filter(
            (row) =>
              row.fieldName &&
              normalizeName(row.fieldName) === normalizeName(field.name),
          )
          .map((row) => row.id);
        if (ids.length) {
          await tx.assemblyLine.updateMany({
            where: { id: { in: ids } },
            data: { fieldName: name },
          });
        }
      }
      return tx.assemblyField.update({
        where: { id: field.id },
        data: { name, defaultValue, allowsFraction },
      });
    });
    return {
      ...this.fieldView(assembly, saved),
      fromProcess: field.fromProcess,
    };
  }

  async removeField(ctx: Ctx, fieldId: string) {
    const { assembly } = await this.writable(ctx);
    const field = assemblyFields(assembly).find((item) => item.id === fieldId);
    if (!field) throw new NotFoundException(FIELD_NOT_FOUND);
    if (field.virtual) bad(FIELD_FROM_PROCESS);
    const { usedBy } = this.fieldView(assembly, field);
    if (usedBy.length) bad(FIELD_IN_USE(usedBy));
    await this.prisma.assemblyField.delete({ where: { id: field.id } });
  }

  /* =============================================================== fórmulas */

  async addFormula(ctx: Ctx, dto: ProductCreateFormulaDto) {
    const { product, assembly } = await this.writable(ctx);
    const name = dto.name.trim();
    if (!name) bad('Dê um nome à fórmula');
    const error = await this.formulaError(
      ctx.companyId,
      product,
      assembly,
      dto.expression,
    );
    if (error) bad(error);
    if (findByName(assemblyFormulas(assembly), name)) {
      bad('Já existe uma fórmula com esse nome neste produto');
    }
    const formula = await this.prisma.assemblyFormula.create({
      data: {
        assemblyId: assembly.id,
        name,
        expression: dto.expression.trim(),
      },
    });
    return {
      id: formula.id,
      name: formula.name,
      expression: formula.expression,
      processId: null,
      usedBy: [] as string[],
      error: null,
    };
  }

  async updateFormula(
    ctx: Ctx,
    formulaId: string,
    dto: ProductUpdateFormulaDto,
  ) {
    const { product, assembly } = await this.writable(ctx);
    const formulas = assemblyFormulas(assembly);
    const formula = formulas.find((item) => item.id === formulaId);
    if (!formula) throw new NotFoundException(FORMULA_NOT_FOUND);
    if (formula.processId) bad(FORMULA_FROM_PROCESS);

    const data: Prisma.AssemblyFormulaUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) bad('Dê um nome à fórmula');
      const other = findByName(formulas, name);
      if (other && other.id !== formulaId) {
        bad('Já existe uma fórmula com esse nome neste produto');
      }
      data.name = name;
    }
    if (dto.expression !== undefined) {
      const error = await this.formulaError(
        ctx.companyId,
        product,
        assembly,
        dto.expression,
      );
      if (error) bad(error);
      data.expression = dto.expression.trim();
    }
    const saved = await this.prisma.assemblyFormula.update({
      where: { id: formulaId },
      data,
    });
    return {
      id: saved.id,
      name: saved.name,
      expression: saved.expression,
      processId: null,
      usedBy: this.formulaUsage(assembly, formulaId),
      error: null,
    };
  }

  async removeFormula(ctx: Ctx, formulaId: string) {
    const { assembly } = await this.writable(ctx);
    const formula = assemblyFormulas(assembly).find(
      (item) => item.id === formulaId,
    );
    if (!formula) throw new NotFoundException(FORMULA_NOT_FOUND);
    if (formula.processId) bad(FORMULA_FROM_PROCESS);
    const usedBy = this.formulaUsage(assembly, formulaId);
    if (usedBy.length) bad(FORMULA_IN_USE(usedBy));
    await this.prisma.assemblyFormula.delete({ where: { id: formulaId } });
  }

  /* ================================================ variação com composição */

  /**
   * A variação com composição própria (PRO, 03/10/2026): nasce como cópia da
   * padrão ou de outra variação (etapas, linhas, campos, fórmulas, faixas e
   * situação) e depois é independente.
   */
  async createVariation(ctx: Ctx, dto: CreateAssemblyVariationDto) {
    const product = await this.product(ctx);
    const name = dto.name.trim();
    if (!name) bad('Dê um nome à variação (P, M, G…)');
    if (
      product.variations.some(
        (item) => normalizeName(item.name) === normalizeName(name),
      )
    ) {
      bad('Já existe uma variação com esse nome');
    }
    const items = await this.prisma.productItem.count({
      where: { productId: product.id },
    });
    if (items > 1) {
      bad(
        'Variações valem para produto de uma unidade de venda; kit não tem variação.',
      );
    }
    const origin = dto.copyFrom
      ? this.variationOf(product, dto.copyFrom)
      : undefined;
    const sourceKey = origin?.assemblies.length ? origin.id : '';
    const source = await this.assemblyRow(product.id, sourceKey);
    const tiers = origin?.priceTiers.length
      ? origin.priceTiers
      : product.priceTiers;

    const variation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productVariation.create({
        data: {
          productId: product.id,
          name,
          position: product.variations.length
            ? (
                await tx.productVariation.aggregate({
                  where: { productId: product.id },
                  _max: { position: true },
                })
              )._max.position! + 1
            : 0,
        },
      });
      await this.copyAssembly(tx, source, {
        companyId: ctx.companyId,
        productId: product.id,
        variationId: created.id,
      });
      if (tiers.length) {
        await tx.productPriceTier.createMany({
          data: tiers.map((tier) => ({
            productId: product.id,
            variationId: created.id,
            from: tier.from,
            unitPrice: tier.unitPrice,
          })),
        });
      }
      return created;
    });
    return {
      id: variation.id,
      name: variation.name,
      unitPrice: null,
      hasOwnAssembly: true,
    };
  }

  /**
   * Copia a composição com ids novos: etapas (ligações remapeadas), linhas e
   * opções (a escolhida remapeada), campos e fórmulas. A etapa de processo
   * continua ligada ao mesmo processo. Serve à variação e ao duplicar.
   */
  async copyAssembly(
    tx: Prisma.TransactionClient,
    source: AssemblyRow | null,
    target: {
      companyId: string;
      productId?: string | null;
      // O rascunho do item montado (ORC-11), no lugar do produto
      draftId?: string | null;
      variationId: string | null;
    },
  ) {
    const id = randomUUID();
    await tx.productAssembly.create({
      data: {
        id,
        companyId: target.companyId,
        productId: target.productId ?? null,
        draftId: target.draftId ?? null,
        variationId: target.variationId,
        variationKey: target.variationId ?? '',
        status: source?.status ?? 'DRAFT',
        dimension: source?.dimension ?? 'SALE',
        allowRenameStages: source?.allowRenameStages ?? false,
      },
    });
    if (!source) return id;

    const blockIds = new Map(source.blocks.map((b) => [b.id, randomUUID()]));
    const formulaIds = new Map(
      source.formulas.map((f) => [f.id, randomUUID()]),
    );
    const remap = (map: Map<string, string>, value: string | null) =>
      value ? (map.get(value) ?? value) : null;

    if (source.fields.length) {
      await tx.assemblyField.createMany({
        data: source.fields.map((field) => ({
          assemblyId: id,
          name: field.name,
          defaultValue: field.defaultValue,
          allowsFraction: field.allowsFraction,
        })),
      });
    }
    if (source.formulas.length) {
      await tx.assemblyFormula.createMany({
        data: source.formulas.map((formula) => ({
          id: formulaIds.get(formula.id)!,
          assemblyId: id,
          name: formula.name,
          expression: formula.expression,
          sourceFormulaId: formula.sourceFormulaId,
          sourceProcessId: formula.sourceProcessId,
        })),
      });
    }
    for (const block of source.blocks) {
      const blockId = blockIds.get(block.id)!;
      await tx.assemblyBlock.create({
        data: {
          id: blockId,
          assemblyId: id,
          type: block.type,
          processId: block.processId,
          partProductId: block.partProductId,
          name: block.name,
          sectorId: block.sectorId,
          setupMinutes: block.setupMinutes,
          taskType: block.taskType,
          rules: jsonOrNull(block.rules),
          dependsOn: block.dependsOn.map((dep) => blockIds.get(dep) ?? dep),
          baseBlockId: remap(blockIds, block.baseBlockId),
          localName: block.localName,
          localTaskType: block.localTaskType,
          localRules: jsonOrNull(block.localRules),
          removedSourceLineIds: block.removedSourceLineIds,
          position: block.position,
        },
      });
      for (const row of block.lines) {
        const optionIds = new Map(row.options.map((o) => [o.id, randomUUID()]));
        const lineId = randomUUID();
        await tx.assemblyLine.create({
          data: {
            id: lineId,
            blockId,
            sourceLineId: row.sourceLineId,
            overridden: row.overridden,
            addedHere: row.addedHere,
            name: row.name,
            kind: row.kind,
            mode: row.mode,
            formula: row.formula,
            perUnit: row.perUnit,
            lossPercent: row.lossPercent,
            minimum: row.minimum,
            optional: row.optional,
            optionalDefault: row.optionalDefault,
            fieldName: row.fieldName,
            formulaId: remap(formulaIds, row.formulaId),
            people: row.people,
            sheetMargin: row.sheetMargin,
            sheetGap: row.sheetGap,
            timePrecision: row.timePrecision,
            chargeWholeSheets: row.chargeWholeSheets,
            // A escolha da linha que acompanha o processo é uma opção dele
            selectedOptionId: remap(optionIds, row.selectedOptionId),
            position: row.position,
          },
        });
        if (row.options.length) {
          await tx.assemblyLineOption.createMany({
            data: row.options.map((option) => ({
              id: optionIds.get(option.id)!,
              lineId,
              resourceId: option.resourceId,
              configName: option.configName,
              perUnit: option.perUnit,
              lossPercent: option.lossPercent,
              minimum: option.minimum,
              position: option.position,
            })),
          });
        }
      }
    }
    return id;
  }

  /* ================================================================== apoio */

  async product(ctx: Ctx): Promise<OwnerRow> {
    if (ctx.draftId) {
      const draft = await this.prisma.quotationDraft.findFirst({
        where: { id: ctx.draftId, companyId: ctx.companyId },
        select: {
          id: true,
          companyId: true,
          name: true,
          width: true,
          height: true,
        },
      });
      if (!draft) throw new NotFoundException(DRAFT_NOT_FOUND);
      return draftOwner(draft);
    }
    const product = await this.prisma.product.findFirst({
      where: { id: ctx.productId, companyId: ctx.companyId },
      select: PRODUCT_SELECT,
    });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return product;
  }

  variationOf(product: ProductRow, variationId?: string | null) {
    if (!variationId) return undefined;
    const variation = product.variations.find(
      (item) => item.id === variationId,
    );
    if (!variation) throw new NotFoundException(VARIATION_NOT_FOUND);
    return variation;
  }

  assemblyRow(productId: string, variationKey: string) {
    return this.prisma.productAssembly.findUnique({
      where: { productId_variationKey: { productId, variationKey } },
      include: ASSEMBLY_INCLUDE,
    });
  }

  /** A composição do dono: a do produto (ou da variação) ou a do rascunho. */
  assemblyOf(owner: OwnerRow, variationKey: string) {
    return owner.draftId
      ? this.prisma.productAssembly.findUnique({
          where: { draftId: owner.draftId },
          include: ASSEMBLY_INCLUDE,
        })
      : this.assemblyRow(owner.id, variationKey);
  }

  /**
   * A composição em que se escreve: a padrão (criada na primeira escrita) ou
   * a própria da variação.
   */
  private async writable(ctx: Ctx) {
    const product = await this.product(ctx);
    const variation = this.variationOf(product, ctx.variationId);
    if (variation && !variation.assemblies.length) bad(OWN_ASSEMBLY_REQUIRED);
    const key = variation?.id ?? '';
    let assembly = await this.assemblyOf(product, key);
    if (!assembly) {
      if (product.draftId) {
        // O rascunho do item montado: a composição nasce na primeira etapa
        await this.prisma.productAssembly.upsert({
          where: { draftId: product.draftId },
          create: { companyId: ctx.companyId, draftId: product.draftId },
          update: {},
        });
      } else {
        await this.prisma.productAssembly.upsert({
          where: {
            productId_variationKey: {
              productId: product.id,
              variationKey: key,
            },
          },
          create: {
            companyId: ctx.companyId,
            productId: product.id,
            variationId: variation?.id ?? null,
            variationKey: key,
          },
          update: {},
        });
      }
      assembly = (await this.assemblyOf(product, key))!;
    }
    return { product, assembly };
  }

  private findBlock(assembly: AssemblyRow, blockId: string) {
    const block = assembly.blocks.find((item) => item.id === blockId);
    if (!block) throw new NotFoundException(BLOCK_NOT_FOUND);
    return block;
  }

  /**
   * A linha pelo id que a leitura mostra: o da linha do processo, quando veio
   * dele, ou o da linha deste produto.
   */
  private resolveLine(block: BlockRow, lineId: string): ResolvedLine {
    if (block.type === 'PROCESS' && block.process) {
      const origin = block.process.lines.find((line) => line.id === lineId);
      if (origin && !block.removedSourceLineIds.includes(lineId)) {
        return {
          kind: 'process',
          origin,
          row: block.lines.find((row) => row.sourceLineId === lineId),
        };
      }
    }
    const sources = new Set(block.process?.lines.map((line) => line.id));
    const row = block.lines.find(
      (item) =>
        item.id === lineId &&
        (!item.sourceLineId ||
          (item.overridden && !sources.has(item.sourceLineId))),
    );
    if (!row) throw new NotFoundException(LINE_NOT_FOUND);
    return { kind: 'own', row };
  }

  /** A escolha da linha que acompanha o processo, guardada à parte. */
  private async saveChoice(
    block: BlockRow,
    target: Extract<ResolvedLine, { kind: 'process' }>,
    selectedOptionId: string | null,
  ) {
    if (target.row) {
      await this.prisma.assemblyLine.update({
        where: { id: target.row.id },
        data: { selectedOptionId },
      });
      return;
    }
    await this.prisma.assemblyLine.create({
      data: {
        blockId: block.id,
        sourceLineId: target.origin.id,
        overridden: false,
        name: target.origin.name,
        kind: target.origin.kind,
        mode: target.origin.mode,
        selectedOptionId,
      },
    });
  }

  /**
   * A linha do processo passa a ser deste produto (CP-21): copia os dados e
   * as opções, com ids novos. Devolve a linha e o mapa das opções.
   */
  private async overridden(
    tx: Prisma.TransactionClient,
    block: BlockRow,
    target: ResolvedLine,
  ): Promise<{ row: LineRow; optionMap: Map<string, string> }> {
    if (target.kind === 'own') return { row: target.row, optionMap: new Map() };
    if (target.row?.overridden) {
      return { row: target.row, optionMap: new Map() };
    }
    const { origin, row: existing } = target;
    const optionMap = new Map(origin.options.map((o) => [o.id, randomUUID()]));
    const chosen =
      existing?.selectedOptionId && optionMap.has(existing.selectedOptionId)
        ? existing.selectedOptionId
        : origin.selectedOptionId;
    const data = {
      sourceLineId: origin.id,
      overridden: true,
      addedHere: false,
      name: origin.name,
      kind: origin.kind,
      mode: origin.mode,
      formula: origin.formula,
      perUnit: origin.perUnit,
      lossPercent: origin.lossPercent,
      minimum: origin.minimum,
      optional: origin.optional,
      optionalDefault: origin.optionalDefault,
      fieldName: origin.fieldName,
      formulaId: origin.formulaId,
      people: origin.people,
      sheetMargin: origin.sheetMargin,
      sheetGap: origin.sheetGap,
      timePrecision: origin.timePrecision,
      chargeWholeSheets: origin.chargeWholeSheets,
      selectedOptionId: chosen ? (optionMap.get(chosen) ?? null) : null,
    };
    let rowId: string;
    if (existing) {
      rowId = existing.id;
      await tx.assemblyLineOption.deleteMany({ where: { lineId: rowId } });
      await tx.assemblyLine.update({ where: { id: rowId }, data });
    } else {
      rowId = randomUUID();
      await tx.assemblyLine.create({
        data: { ...data, id: rowId, blockId: block.id },
      });
    }
    if (origin.options.length) {
      await tx.assemblyLineOption.createMany({
        data: origin.options.map((option) => ({
          id: optionMap.get(option.id)!,
          lineId: rowId,
          resourceId: option.resourceId,
          configName: option.configName,
          perUnit: option.perUnit,
          lossPercent: option.lossPercent,
          minimum: option.minimum,
          position: option.position,
        })),
      });
    }
    const row = await tx.assemblyLine.findUniqueOrThrow({
      where: { id: rowId },
      include: LINE_INCLUDE,
    });
    return { row, optionMap };
  }

  private async applyLineUpdate(
    assembly: AssemblyRow,
    rowId: string,
    data: Prisma.AssemblyLineUncheckedUpdateInput,
    optionUpdates: { id: string; data: Prisma.AssemblyLineOptionUpdateInput }[],
    body: { fieldDefault?: number | null },
    tx?: Prisma.TransactionClient,
  ) {
    const run = async (client: Prisma.TransactionClient) => {
      if (typeof data.fieldName === 'string') {
        data.fieldName = await this.ensureField(
          client,
          assembly,
          data.fieldName,
          body.fieldDefault ?? undefined,
        );
      }
      await client.assemblyLine.update({ where: { id: rowId }, data });
      for (const option of optionUpdates) {
        await client.assemblyLineOption.update({
          where: { id: option.id },
          data: option.data,
        });
      }
    };
    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  /**
   * O campo que a linha lê existe no produto (IP-4): o do processo ligado
   * serve, pelo nome. Devolve o nome que vale.
   */
  private async ensureField(
    tx: Prisma.TransactionClient,
    assembly: AssemblyRow,
    name: string,
    defaultValue = 0,
  ) {
    const found = findByName(assemblyFields(assembly), name);
    if (found) return found.name;
    await tx.assemblyField.create({
      data: {
        assemblyId: assembly.id,
        name,
        defaultValue,
        allowsFraction: !Number.isInteger(defaultValue),
      },
    });
    return name;
  }

  private formulaIds(assembly: AssemblyRow) {
    return new Set(assemblyFormulas(assembly).map((formula) => formula.id));
  }

  /** Em que etapas o campo é lido: a linha que aponta ou a fórmula que cita. */
  private fieldView(
    assembly: AssemblyRow,
    field: {
      id: string;
      name: string;
      defaultValue: number;
      allowsFraction?: boolean;
    },
  ) {
    const formulas = assemblyFormulas(assembly);
    const usedBy = assembly.blocks
      .filter((block) =>
        mergedLines(block).some((line) => {
          if (
            line.fieldName &&
            normalizeName(line.fieldName) === normalizeName(field.name)
          ) {
            return true;
          }
          if (line.formula !== 'CUSTOM' || !line.formulaId) return false;
          const formula = formulas.find((item) => item.id === line.formulaId);
          return !!formula && formulaUsesName(formula.expression, field.name);
        }),
      )
      .map(stageName);
    return {
      id: field.id,
      name: field.name,
      defaultValue: field.defaultValue,
      allowsFraction: !!field.allowsFraction,
      usedBy,
    };
  }

  private formulaUsage(assembly: AssemblyRow, formulaId: string) {
    return assembly.blocks
      .filter((block) =>
        mergedLines(block).some(
          (line) => line.formula === 'CUSTOM' && line.formulaId === formulaId,
        ),
      )
      .map(stageName);
  }

  /** O erro da fórmula na medida padrão, com campos e referências de material. */
  private async formulaError(
    companyId: string,
    product: ProductRow,
    assembly: AssemblyRow,
    expression: string,
  ) {
    const graph = await this.loadGraph(companyId, [assembly]);
    const engine = new EngineBuilder(graph).build(
      product,
      assembly,
      productPricing(product).measure,
    );
    return evaluateFormula(
      expression,
      formulaVars(fieldsWithImplied(engine), engine.blocks, engine.measure, 0),
    ).error;
  }

  /**
   * As partes (até três níveis) e os recursos de todas as linhas, lidos de
   * uma vez para o motor.
   */
  async loadGraph(
    companyId: string,
    roots: (AssemblyRow | null)[],
  ): Promise<AssemblyGraph> {
    const parts = new Map<string, GraphPart>();
    let frontier = roots.flatMap(partIdsOf);
    for (let level = 0; level < MAX_PART_LEVELS && frontier.length; level++) {
      const ids = [...new Set(frontier)].filter((id) => !parts.has(id));
      if (!ids.length) break;
      const [products, assemblies] = await Promise.all([
        this.prisma.product.findMany({
          where: { id: { in: ids }, companyId },
          select: PRODUCT_SELECT,
        }),
        this.prisma.productAssembly.findMany({
          where: { productId: { in: ids }, companyId, variationKey: '' },
          include: ASSEMBLY_INCLUDE,
        }),
      ]);
      for (const product of products) {
        parts.set(product.id, {
          product,
          assembly: assemblies.find((a) => a.productId === product.id) ?? null,
        });
      }
      frontier = assemblies.flatMap(partIdsOf);
    }

    const all = [
      ...roots,
      ...[...parts.values()].map((part) => part.assembly),
    ].filter((item): item is AssemblyRow => !!item);
    const resourceIds = [
      ...new Set(
        all.flatMap((assembly) =>
          assembly.blocks.flatMap((block) => [
            ...mergedLines(block).flatMap((line) =>
              line.options.map((option) => option.resourceId),
            ),
          ]),
        ),
      ),
    ];
    return {
      parts,
      resources: await this.resources.resolve(companyId, resourceIds),
    };
  }

  /** Os produtos que contêm este como parte, por dentro de outras partes. */
  private async containersOf(companyId: string, productId: string) {
    const found = new Set<string>();
    let frontier = [productId];
    for (let level = 0; level < 5 && frontier.length; level++) {
      const blocks = await this.prisma.assemblyBlock.findMany({
        where: {
          partProductId: { in: frontier },
          // O rascunho do item montado não contém produto (ORC-11)
          assembly: { companyId, productId: { not: null } },
        },
        select: { assembly: { select: { productId: true } } },
      });
      frontier = blocks
        .map((block) => block.assembly.productId)
        .filter((id) => !found.has(id) && id !== productId);
      frontier.forEach((id) => found.add(id));
    }
    return [...found];
  }

  private compute(
    builder: EngineBuilder,
    graph: AssemblyGraph,
    markup: number,
    product: ProductRow,
    assembly: AssemblyRow | null,
    variation: EngineVariation | null,
    measure: Measure,
  ): ComputedAssembly {
    return computeAssembly(
      builder.build(product, assembly, measure),
      {
        referenceMarkup: markup,
        partOf: builder.partOf,
        resourceName: (id) => graph.resources.get(id)?.name,
      },
      variation,
      0,
      (block) => {
        const sector = builder.labor.get(block.id);
        return sector
          ? { id: `labor:${sector.id}`, name: `Mão de obra · ${sector.name}` }
          : { id: `labor:${block.id}`, name: 'Mão de obra' };
      },
    );
  }

  private assemblyView(
    product: ProductRow,
    assembly: AssemblyRow | null,
    computed: ComputedAssembly,
    builder: EngineBuilder,
    markup: number,
  ) {
    const rows = new Map(assembly?.blocks.map((block) => [block.id, block]));
    const formulaNames = new Map(
      assemblyFormulas(assembly).map((formula) => [formula.id, formula.name]),
    );
    const fieldsById = new Map<string, AssemblyField>(
      assemblyFields(assembly).map((field) => [field.id, field]),
    );
    const pricing = productPricing(product);

    const blocks = computed.blocks.map((block) => {
      const row = rows.get(block.id)!;
      const sector = builder.labor.get(block.id);
      const sources = new Set(row.process?.lines.map((line) => line.id));
      return {
        id: block.id,
        type: row.type,
        processId: row.type === 'PROCESS' ? row.processId : null,
        partProductId: row.type === 'PART' ? row.partProductId : null,
        name: block.name,
        localName: row.type === 'PROCESS' ? row.localName : null,
        sectorId: sector?.id ?? null,
        sector: block.sector,
        dependsOn: block.dependsOn,
        baseBlockId: block.baseBlockId,
        role: block.dependsOn.length ? 'FINISHING' : 'BASE',
        setupMinutes: block.setupMinutes,
        taskType:
          row.type === 'PROCESS' && row.process
            ? (row.localTaskType ?? row.process.taskType)
            : row.taskType,
        rules: block.rules,
        // As regras sem o ajuste deste produto: as do processo pela posição
        originalRules: block.originalRules,
        rulesOverridden: row.type === 'PROCESS' && !!row.localRules,
        removedProcessLines: row.removedSourceLineIds.filter((id) =>
          sources.has(id),
        ).length,
        processInactive: block.processInactive,
        partInactive: block.partInactive,
        measure: measureMm(block.measure),
        setupCost: block.setupCost,
        setupSale: block.setupSale,
        cost: block.cost,
        sale: block.sale,
        part: block.part,
        partFlow: block.partFlow,
        partLines: block.partLines.map((line) =>
          lineView(line, markup, formulaNames),
        ),
        partSetupMinutes: block.partSetupMinutes,
        lines: block.lines.map((line) => lineView(line, markup, formulaNames)),
      };
    });

    // Avisos: linha sem recurso (IP-37) e caminho que não chega ao fim (FL-12)
    const warnings: { blockId: string; lineId?: string; code: string }[] = [];
    blocks.forEach((block) =>
      block.lines.forEach((line) => {
        if (!line.options.length) {
          warnings.push({
            blockId: block.id,
            lineId: line.id,
            code: 'LINE_WITHOUT_RESOURCE',
          });
        }
      }),
    );
    const awaited = new Set(blocks.flatMap((block) => block.dependsOn));
    const ends = blocks.filter((block) => !awaited.has(block.id));
    ends
      .slice(0, -1)
      .forEach((block) =>
        warnings.push({ blockId: block.id, code: 'DISCONNECTED_PATH' }),
      );

    return {
      productId: product.id,
      name: product.name,
      code: product.code,
      unitKind: pricing.unitKind,
      unitPrice: computed.activeVariation?.unitPrice ?? pricing.unitPrice,
      // O cadastro que a tela da composição mostra junto (CP-16)
      unitAmount: pricing.unitAmount,
      technicalDescription: product.technicalDescription ?? '',
      allowEditValues: product.allowEditValues,
      allowEditDescription: product.allowEditDescription,
      priceTiers: product.priceTiers,
      status: assembly?.status ?? 'DRAFT',
      dimension: assembly?.dimension ?? 'SALE',
      allowRenameStages: assembly?.allowRenameStages ?? false,
      isActive: product.isActive,
      measure: measureMm(computed.measure),
      area: computed.area,
      blocks,
      resourceSummary: computed.resourceSummary.map(summaryView),
      fields: computed.fields.map((field) => ({
        id: field.id,
        name: field.name,
        defaultValue: field.defaultValue,
        allowsFraction: !!field.allowsFraction,
        usedBy: field.usedBy,
        fromProcess: fieldsById.get(field.id)?.fromProcess ?? false,
      })),
      formulas: computed.formulas.map((formula) => ({
        id: formula.id,
        name: formula.name,
        expression: formula.expression,
        processId: formula.processId ?? null,
        usedBy: formula.usedBy,
        error: formula.error,
      })),
      cost: computed.cost,
      suggestedPrice: computed.suggestedPrice,
      saleAmount: computed.saleAmount,
      priceForMeasure: computed.priceForMeasure,
      suggestedUnitPrice: computed.suggestedUnitPrice,
      margin: computed.margin,
      activeTier: computed.activeTier,
      effectiveTiers: computed.effectiveTiers,
      tiersFromVariation: computed.tiersFromVariation,
      warnings,
    };
  }
}
