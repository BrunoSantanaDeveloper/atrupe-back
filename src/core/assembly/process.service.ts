import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { omitMoneyFields } from '../auth/abac/values-visibility.interceptor';
import { PricingParametersService } from '../pricing/pricing-parameters.service';
import {
  AssemblyResource,
  AssemblyResourceService,
  hourCostOf,
} from './assembly-resource.service';
import {
  ASSEMBLY_MONEY_FIELDS,
  blockLinesView,
  measureMm,
  summaryView,
  toMeters,
} from './assembly-view';
import {
  FIELD_IN_USE,
  FIELD_NOT_FOUND,
  FORMULA_IN_USE,
  FORMULA_NOT_FOUND,
  LINE_INCLUDE,
  LINE_NOT_FOUND,
  findByName,
  integerCheck,
  lineUpdateData,
  newLineData,
  newOptionData,
  removeOptionData,
  resourceIdsOf,
  toEngineLine,
} from './composition-lines';
import {
  CreateFieldDto,
  CreateFormulaDto,
  CreateLineDto,
  CreateOptionDto,
  UpdateFieldDto,
  UpdateFormulaDto,
  UpdateLineDto,
} from './dto/composition.dto';
import {
  CreateProcessDto,
  ProcessFilterDto,
  ProcessSimulationDto,
  UpdateProcessDto,
  UsualNextDto,
} from './dto/process.dto';
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
import { EngineAssembly, EngineBlock } from './engine/types';
import { BASE_RULES, mergeRules, rulesByPosition, rulesOf } from './sale-rules';

export const PROCESS_NOT_FOUND = 'Processo não encontrado';
/** Teto de itens por página (SEG-2). */
export const PROCESS_PAGE_LIMIT = 100;
const SECTOR_REQUIRED = 'Escolha um setor ativo';
/** A medida padrão do processo: 1 × 1 m, uma unidade */
const DEFAULT_MEASURE = { quantity: 1, width: 1000, height: 1000 };
const SIM_BASE_ID = 'sim-base';

const SECTOR_SELECT = {
  id: true,
  name: true,
  saleUnit: true,
  hourCost: true,
  hourSale: true,
} satisfies Prisma.CompanySectorSelect;

// Os processos de que este "costuma vir depois" (FL-7), na ordem de cadastro
const USUAL_BEFORE = {
  select: { from: { select: { name: true } } },
  orderBy: { from: { createdAt: 'asc' } },
} satisfies Prisma.Process$usualBeforeArgs;

const PROCESS_INCLUDE = {
  sector: { select: SECTOR_SELECT },
  lines: {
    include: LINE_INCLUDE,
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
  fields: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  formulas: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  usualBefore: USUAL_BEFORE,
} satisfies Prisma.ProcessInclude;

type ProcessRow = Prisma.ProcessGetPayload<{
  include: typeof PROCESS_INCLUDE;
}>;

const LIST_INCLUDE = {
  sector: { select: { name: true } },
  lines: { select: { kind: true, _count: { select: { options: true } } } },
  usualBefore: USUAL_BEFORE,
} satisfies Prisma.ProcessInclude;

type Measure = { quantity: number; width: number; height: number };

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

/**
 * A categoria do processo (MS-7): "Depois de X, Y" pelos pares FL-7 que
 * chegam a ele; sem par, "Serviço de máquina" se tem linha de máquina, senão
 * "Primário".
 */
const categoryOf = (row: {
  usualBefore: { from: { name: string } }[];
  lines: { kind: string }[];
}) => {
  const before = row.usualBefore.map((pair) => pair.from.name);
  if (before.length) return `Depois de ${before.join(', ')}`;
  return row.lines.some((line) => line.kind === 'MACHINE')
    ? 'Serviço de máquina'
    : 'Primário';
};

/** O processo como etapa sozinha, como o motor lê (MS-11). */
const processBlock = (
  row: ProcessRow,
  resources: Map<string, AssemblyResource>,
): EngineBlock => ({
  id: row.id,
  processId: null,
  name: row.name,
  sector: row.sector.name,
  dependsOn: [],
  baseBlockId: null,
  setupMinutes: row.setupMinutes,
  sectorHourCost: hourCostOf(resources, row.sector),
  sectorHourSale: row.sector.hourSale ?? 0,
  originalRules: rulesOf(row.rules),
  localRules: null,
  lines: row.lines.map((line) => toEngineLine(line, resources)),
});

/**
 * O processo dentro de uma composição de mentira, para o motor. Com a base
 * simulada (§9.1), ele entra depois de uma etapa sem custo de medida fixa,
 * com as regras que teria no produto (rulesByPosition).
 */
const engineAssemblyOf = (
  row: ProcessRow,
  resources: Map<string, AssemblyResource>,
  measure: Measure,
  base: Measure | null,
): EngineAssembly => {
  const block = processBlock(row, resources);
  const blocks: EngineBlock[] = base
    ? [
        {
          id: SIM_BASE_ID,
          processId: null,
          name: 'Etapa anterior',
          sector: row.sector.name,
          dependsOn: [],
          baseBlockId: null,
          setupMinutes: 0,
          sectorHourCost: 0,
          sectorHourSale: 0,
          originalRules: { ...BASE_RULES },
          localRules: null,
          lines: [],
          fixedMeasure: {
            quantity: base.quantity,
            width: toMeters(base.width),
            height: toMeters(base.height),
          },
        },
        {
          ...block,
          dependsOn: [SIM_BASE_ID],
          baseBlockId: SIM_BASE_ID,
          originalRules: rulesByPosition(block.originalRules, row.afterBase, [
            SIM_BASE_ID,
          ]),
        },
      ]
    : [block];
  return {
    productId: `process:${row.id}`,
    name: row.name,
    unitKind: 'AREA',
    unitPrice: null,
    measure: {
      quantity: measure.quantity,
      width: toMeters(measure.width),
      height: toMeters(measure.height),
    },
    unitAmount: 1,
    priceTiers: [],
    blocks,
    fields: row.fields.map((field) => ({
      id: field.id,
      name: field.name,
      defaultValue: field.defaultValue,
      allowsFraction: field.allowsFraction,
    })),
    formulas: row.formulas.map((formula) => ({
      id: formula.id,
      name: formula.name,
      expression: formula.expression,
    })),
  };
};

/**
 * Processos (MS-11): a etapa reutilizável de um setor, guardada no formato
 * da etapa da composição. O produto que inclui o processo acompanha a
 * montagem dele (CP-21): mudar o processo muda os produtos, e cada escrita
 * devolve quantos produtos ela alcança.
 *
 * O acesso ao detalhe (SEG-4) fica no registro de atividade, que guarda rota
 * e método de toda requisição autenticada.
 */
@Injectable()
export class ProcessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: AssemblyResourceService,
    private readonly pricing: PricingParametersService,
  ) {}

  /* ---------------------------------------------------------------- leitura */

  async list(
    companyId: string,
    filter: ProcessFilterDto,
    options: { onlyActive: boolean },
  ) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 50, PROCESS_PAGE_LIMIT);
    const inactive = !options.onlyActive && filter.status === 'inativos';
    const search = filter.search?.trim();
    const where: Prisma.ProcessWhereInput = {
      companyId,
      isActive: !inactive,
      ...(filter.sectorId ? { sectorId: filter.sectorId } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.process.count({ where }),
      this.prisma.process.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: LIST_INCLUDE,
      }),
    ]);
    const linked = await this.linkedProducts(
      companyId,
      rows.map((row) => row.id),
    );

    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        sectorId: row.sectorId,
        sector: row.sector.name,
        category: categoryOf(row),
        afterBase: row.afterBase,
        taskType: row.taskType,
        setupMinutes: row.setupMinutes,
        rules: rulesOf(row.rules),
        lines: row.lines.length,
        kinds: [...new Set(row.lines.map((line) => line.kind))],
        // Linha sem recurso é erro de cadastro (IP-37, MS-8)
        incomplete:
          !row.lines.length || row.lines.some((line) => !line._count.options),
        isActive: row.isActive,
        usedIn: linked.get(row.id)?.size ?? 0,
      })),
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }

  async quantity(companyId: string) {
    const [active, inactive] = await this.prisma.$transaction([
      this.prisma.process.count({ where: { companyId, isActive: true } }),
      this.prisma.process.count({ where: { companyId, isActive: false } }),
    ]);
    return { active, inactive };
  }

  /**
   * O processo com a simulação numa medida (CP-2, PAD-6). Não grava nada.
   * Sem `values`, saem custo e venda.
   */
  async detail(
    companyId: string,
    id: string,
    simulation: ProcessSimulationDto,
    options: { values: boolean },
  ) {
    const row = await this.findProcess(companyId, id);
    const resources = await this.resources.resolve(
      companyId,
      resourceIdsOf(row.lines),
    );
    const markup = await this.pricing.referenceMarkupOf(companyId);

    const measure = {
      quantity: simulation.quantity ?? DEFAULT_MEASURE.quantity,
      width: simulation.width ?? DEFAULT_MEASURE.width,
      height: simulation.height ?? DEFAULT_MEASURE.height,
    };
    const simulatesBase =
      simulation.baseQuantity !== undefined ||
      simulation.baseWidth !== undefined ||
      simulation.baseHeight !== undefined;
    const base = simulatesBase
      ? {
          quantity: simulation.baseQuantity ?? 1,
          width: simulation.baseWidth ?? measure.width,
          height: simulation.baseHeight ?? measure.height,
        }
      : null;

    const computed = computeAssembly(
      engineAssemblyOf(row, resources, measure, base),
      {
        referenceMarkup: markup,
        partOf: () => null,
        resourceName: (resourceId) => resources.get(resourceId)?.name,
      },
      null,
      0,
      // O preparo entra no resumo como a mão de obra do setor
      () => ({
        id: `labor:${row.sectorId}`,
        name: `Mão de obra · ${row.sector.name}`,
      }),
    );
    const block = computed.blocks.find((item) => item.id !== SIM_BASE_ID)!;
    const used = (await this.linkedProducts(companyId, [id])).get(id);
    const formulaNames = new Map(row.formulas.map((f) => [f.id, f.name]));

    const result = {
      ...this.header(row),
      measure,
      block: {
        id: block.id,
        name: block.name,
        sectorId: row.sectorId,
        sector: row.sector.name,
        setupMinutes: block.setupMinutes,
        taskType: row.taskType,
        rules: block.rules,
        measure: measureMm(block.measure),
        setupCost: block.setupCost,
        setupSale: block.setupSale,
        cost: block.cost,
        sale: block.sale,
        lines: blockLinesView(block, markup, formulaNames),
      },
      fields: computed.fields.map((field) => ({
        id: field.id,
        name: field.name,
        defaultValue: field.defaultValue,
        allowsFraction: !!field.allowsFraction,
        usedBy: field.usedBy,
      })),
      formulas: computed.formulas.map((formula) => ({
        id: formula.id,
        name: formula.name,
        expression: formula.expression,
        usedBy: formula.usedBy,
        error: formula.error,
      })),
      resourceSummary: computed.resourceSummary.map(summaryView),
      cost: block.cost,
      sale: block.sale,
      usedIn: [...(used ?? new Map<string, string>())].map(
        ([productId, name]) => ({ productId, name }),
      ),
    };
    return options.values
      ? result
      : omitMoneyFields(result, ASSEMBLY_MONEY_FIELDS);
  }

  /**
   * O processo como linha acrescentada no item do orçamento (ORC-5): o
   * cálculo na medida (mm) com os campos informados na venda, e os recursos
   * resolvidos com custo para o retrato (ORC-10). Acompanhando a base, ele
   * entra como etapa depois do item. Não grava nada.
   */
  async lineQuote(
    companyId: string,
    id: string,
    measure: Measure,
    fieldValues: { fieldId: string; value: number }[],
    followsBase: boolean,
  ) {
    const row = await this.findProcess(companyId, id);
    // Inativo não entra na venda (PAD-7); linha sem recurso é erro de
    // cadastro (IP-37)
    if (!row.isActive) bad('Este processo está inativo');
    if (!row.lines.length || row.lines.some((line) => !line.options.length)) {
      bad('Este processo tem linha sem recurso');
    }
    const values = new Map<string, number>();
    for (const item of fieldValues) {
      const field = row.fields.find((f) => f.id === item.fieldId);
      if (!field) throw new NotFoundException(FIELD_NOT_FOUND);
      integerCheck(field, item.value);
      values.set(field.id, item.value);
    }

    const resources = await this.resources.resolve(
      companyId,
      resourceIdsOf(row.lines),
    );
    const engine = engineAssemblyOf(
      row,
      resources,
      measure,
      followsBase ? measure : null,
    );
    engine.fields = (engine.fields ?? []).map((field) => ({
      ...field,
      defaultValue: values.get(field.id) ?? field.defaultValue,
    }));
    const computed = computeAssembly(engine, {
      referenceMarkup: await this.pricing.referenceMarkupOf(companyId),
      partOf: () => null,
      resourceName: (resourceId) => resources.get(resourceId)?.name,
    });
    const block = computed.blocks.find((item) => item.id !== SIM_BASE_ID)!;
    const instructions = row.sellerInstructions.trim();

    return {
      name: row.name,
      sector: row.sector.name,
      // A preferência do processo: herda a medida da base (03/10/2026)
      followsBaseDefault: row.afterBase === 'INHERIT',
      instructions: instructions
        ? [{ stage: row.name, text: instructions }]
        : [],
      price: block.sale,
      cost: block.cost,
      resolved: block.lines.map((line) => ({
        lineId: line.id,
        name: line.name,
        kind: line.kind,
        resourceId: line.selected?.resourceId ?? null,
        resource: line.selected?.name ?? null,
        quantity: line.quantity,
        unit: line.selected?.unit ?? line.options[0]?.unit ?? '',
        unitCost: line.selected?.unitCost ?? null,
        cost: line.cost,
        // O apontamento da produção preenche depois (ORC-9)
        actualQuantity: null,
        actualCost: null,
      })),
    };
  }

  /** As etapas ligadas ao processo, para o diálogo de inativar (PAD-7). */
  async usage(companyId: string, id: string) {
    const process = await this.processForWrite(companyId, id);
    const blocks = await this.prisma.assemblyBlock.findMany({
      // Só os produtos: o rascunho do item montado (ORC-11) não tem nome de produto
      where: {
        processId: id,
        assembly: { companyId, productId: { not: null } },
      },
      orderBy: [{ assembly: { product: { name: 'asc' } } }, { id: 'asc' }],
      select: {
        localName: true,
        assembly: {
          select: {
            productId: true,
            product: { select: { name: true } },
            variation: { select: { name: true } },
          },
        },
      },
    });
    return {
      data: blocks.map((block) => ({
        productId: block.assembly.productId,
        name: block.assembly.product.name,
        variation: block.assembly.variation?.name ?? null,
        stage: block.localName || process.name,
      })),
    };
  }

  /**
   * "Costuma vir depois de" e "etapas seguintes usuais" (FL-7): os outros
   * processos ativos, marcados pelos pares. O inativo só aparece quando já
   * está marcado, para dar para desmarcar; os outros inativos (os de testes
   * antigos, por exemplo) só poluíam a escolha (29/10/2026).
   */
  async usualNext(companyId: string, id: string) {
    await this.processForWrite(companyId, id);
    const [others, pairs] = await Promise.all([
      this.prisma.process.findMany({
        where: { companyId, id: { not: id } },
        select: {
          id: true,
          name: true,
          afterBase: true,
          isActive: true,
          sector: { select: { name: true } },
        },
      }),
      this.prisma.processUsualNext.findMany({
        where: { OR: [{ fromProcessId: id }, { toProcessId: id }] },
        select: { fromProcessId: true, toProcessId: true },
      }),
    ]);
    const before = new Set(
      pairs.filter((p) => p.toProcessId === id).map((p) => p.fromProcessId),
    );
    const after = new Set(
      pairs.filter((p) => p.fromProcessId === id).map((p) => p.toProcessId),
    );
    const listOf = (marked: Set<string>) =>
      others
        .filter((other) => other.isActive || marked.has(other.id))
        .map((other) => ({
          id: other.id,
          name: other.name,
          sector: other.sector.name,
          afterBase: other.afterBase,
          active: other.isActive,
          usual: marked.has(other.id),
        }))
        .sort(
          (a, b) =>
            Number(b.usual) - Number(a.usual) ||
            a.sector.localeCompare(b.sector, 'pt-BR') ||
            a.name.localeCompare(b.name, 'pt-BR'),
        );
    return { before: listOf(before), after: listOf(after) };
  }

  /* --------------------------------------------------------------- cadastro */

  async create(
    companyId: string,
    dto: CreateProcessDto,
    options: { values: boolean },
  ) {
    const name = dto.name.trim();
    if (!name) bad('Informe o nome do processo');
    const sector = await this.activeSector(companyId, dto.sectorId);
    const created = await this.prisma.process.create({
      data: {
        companyId,
        name,
        sectorId: sector.id,
        afterBase: dto.afterBase ?? 'INHERIT',
        setupMinutes: 0,
        taskType: sector.name,
        rules: { ...BASE_RULES },
        isActive: true,
      },
      select: { id: true },
    });
    return this.detail(companyId, created.id, {}, options);
  }

  async update(companyId: string, id: string, dto: UpdateProcessDto) {
    const row = await this.prisma.process.findFirst({
      where: { id, companyId },
      select: { id: true, rules: true },
    });
    if (!row) throw new NotFoundException(PROCESS_NOT_FOUND);

    const data: Prisma.ProcessUncheckedUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) bad('Informe o nome da etapa');
      data.name = name;
    }
    if (dto.sectorId !== undefined) {
      data.sectorId = (await this.activeSector(companyId, dto.sectorId)).id;
    }
    if (dto.afterBase !== undefined) data.afterBase = dto.afterBase;
    if (dto.setupMinutes !== undefined) data.setupMinutes = dto.setupMinutes;
    if (dto.sellerInstructions !== undefined) {
      data.sellerInstructions = dto.sellerInstructions.trim();
    }
    if (dto.taskType?.trim()) data.taskType = dto.taskType.trim();
    if (dto.rules) data.rules = mergeRules(rulesOf(row.rules), dto.rules);

    await this.prisma.process.update({ where: { id }, data });
    return { id, affectedProducts: await this.affectedProducts(companyId, id) };
  }

  /**
   * Inativa ou reativa (PAD-7). Inativo, continua nas etapas dos produtos,
   * mas deixa de ser oferecido.
   */
  async toggleStatus(companyId: string, id: string, isActive: boolean) {
    await this.processForWrite(companyId, id);
    await this.prisma.process.update({ where: { id }, data: { isActive } });
    return { id, isActive };
  }

  /** O par "vem depois de" (FL-7), guardado uma vez. */
  async setUsualNext(companyId: string, dto: UsualNextDto) {
    if (dto.fromProcessId === dto.toProcessId) {
      bad('Um processo não vem depois dele mesmo');
    }
    const found = await this.prisma.process.count({
      where: { companyId, id: { in: [dto.fromProcessId, dto.toProcessId] } },
    });
    if (found !== 2) throw new NotFoundException(PROCESS_NOT_FOUND);

    const pair = {
      fromProcessId: dto.fromProcessId,
      toProcessId: dto.toProcessId,
    };
    if (dto.usual) {
      await this.prisma.processUsualNext.upsert({
        where: { fromProcessId_toProcessId: pair },
        create: pair,
        update: {},
      });
    } else {
      await this.prisma.processUsualNext.deleteMany({ where: pair });
    }
    return { ...pair, usual: dto.usual };
  }

  /* ----------------------------------------------------------------- linhas */

  async addLine(companyId: string, id: string, dto: CreateLineDto) {
    const process = await this.processForWrite(companyId, id);
    const { line, options } = newLineData(dto, {
      resources: await this.resources.resolve(companyId, dto.resourceIds),
      sectorSaleUnit: process.sector.saleUnit,
      formulaIds: new Set(process.formulas.map((formula) => formula.id)),
    });

    await this.prisma.$transaction(async (tx) => {
      const last = await tx.assemblyLine.aggregate({
        where: { processId: id },
        _max: { position: true },
      });
      const fieldName = line.fieldName
        ? await this.ensureField(tx, process, line.fieldName, dto.fieldDefault)
        : null;
      await tx.assemblyLine.create({
        data: {
          ...line,
          fieldName,
          processId: id,
          position: (last._max.position ?? -1) + 1,
          options: { create: options },
        },
      });
    });
    return {
      id: line.id,
      affectedProducts: await this.affectedProducts(companyId, id),
    };
  }

  async updateLine(
    companyId: string,
    id: string,
    lineId: string,
    dto: UpdateLineDto,
  ) {
    const process = await this.processForWrite(companyId, id);
    const row = await this.findLine(id, lineId);
    const { data, optionUpdates } = lineUpdateData(row, dto, {
      formulaIds: new Set(process.formulas.map((formula) => formula.id)),
    });

    await this.prisma.$transaction(async (tx) => {
      if (typeof data.fieldName === 'string') {
        data.fieldName = await this.ensureField(
          tx,
          process,
          data.fieldName,
          dto.fieldDefault,
        );
      }
      await tx.assemblyLine.update({ where: { id: lineId }, data });
      for (const option of optionUpdates) {
        await tx.assemblyLineOption.update({
          where: { id: option.id },
          data: option.data,
        });
      }
    });
    return {
      id: lineId,
      affectedProducts: await this.affectedProducts(companyId, id),
    };
  }

  /**
   * Tira a linha do processo. Nos produtos, a linha que acompanhava some; a
   * que o produto ajustou fica como dele (CP-21, na leitura da composição).
   */
  async removeLine(companyId: string, id: string, lineId: string) {
    await this.processForWrite(companyId, id);
    await this.findLine(id, lineId);
    await this.prisma.assemblyLine.delete({ where: { id: lineId } });
    return {
      id: lineId,
      affectedProducts: await this.affectedProducts(companyId, id),
    };
  }

  async addOption(
    companyId: string,
    id: string,
    lineId: string,
    dto: CreateOptionDto,
  ) {
    const process = await this.processForWrite(companyId, id);
    const row = await this.findLine(id, lineId);
    const resources = await this.resources.resolve(companyId, [
      ...resourceIdsOf([row]),
      dto.resourceId,
    ]);
    const { option, selectedOptionId } = newOptionData(row, dto, {
      resources,
      sectorSaleUnit: process.sector.saleUnit,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.assemblyLineOption.create({ data: { ...option, lineId } });
      if (selectedOptionId) {
        await tx.assemblyLine.update({
          where: { id: lineId },
          data: { selectedOptionId },
        });
      }
    });
    return {
      id: option.id,
      affectedProducts: await this.affectedProducts(companyId, id),
    };
  }

  async removeOption(
    companyId: string,
    id: string,
    lineId: string,
    optionId: string,
  ) {
    await this.processForWrite(companyId, id);
    const row = await this.findLine(id, lineId);
    const { selectedOptionId } = removeOptionData(row, optionId);

    await this.prisma.$transaction(async (tx) => {
      await tx.assemblyLineOption.delete({ where: { id: optionId } });
      if (selectedOptionId) {
        await tx.assemblyLine.update({
          where: { id: lineId },
          data: { selectedOptionId },
        });
      }
    });
    return {
      id: optionId,
      affectedProducts: await this.affectedProducts(companyId, id),
    };
  }

  /* ---------------------------------------------------- campos do orçamento */

  async addField(companyId: string, id: string, dto: CreateFieldDto) {
    const process = await this.processForWrite(companyId, id);
    const name = dto.name.trim();
    if (!name) bad('Informe o nome do campo');
    if (findByName(process.fields, name)) {
      bad('Já existe um campo com esse nome neste produto');
    }
    const allowsFraction = dto.allowsFraction ?? false;
    const defaultValue = dto.defaultValue ?? 0;
    integerCheck({ name, allowsFraction }, defaultValue);

    const field = await this.prisma.assemblyField.create({
      data: { processId: id, name, defaultValue, allowsFraction },
    });
    return this.fieldView(id, process.name, field);
  }

  async updateField(
    companyId: string,
    id: string,
    fieldId: string,
    dto: UpdateFieldDto,
  ) {
    const process = await this.processForWrite(companyId, id);
    const field = process.fields.find((item) => item.id === fieldId);
    if (!field) throw new NotFoundException(FIELD_NOT_FOUND);

    const data: Prisma.AssemblyFieldUpdateInput = {};
    let allowsFraction = field.allowsFraction;
    if (dto.allowsFraction !== undefined) {
      allowsFraction = dto.allowsFraction;
      data.allowsFraction = allowsFraction;
      // Voltando a inteiro, o padrão com fração é arredondado
      if (!allowsFraction) data.defaultValue = Math.round(field.defaultValue);
    }
    if (dto.defaultValue !== undefined) {
      integerCheck({ name: field.name, allowsFraction }, dto.defaultValue);
      data.defaultValue = dto.defaultValue;
    }
    let renamed: string | null = null;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) bad('Informe o nome do campo');
      const other = findByName(process.fields, name);
      if (other && other.id !== field.id) {
        bad('Já existe um campo com esse nome neste produto');
      }
      data.name = name;
      renamed = name;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // As linhas que leem o campo acompanham o nome novo
      if (renamed) {
        const readers = await tx.assemblyLine.findMany({
          where: { processId: id, fieldName: { not: null } },
          select: { id: true, fieldName: true },
        });
        const ids = readers
          .filter(
            (line) =>
              normalizeName(line.fieldName!) === normalizeName(field.name),
          )
          .map((line) => line.id);
        if (ids.length) {
          await tx.assemblyLine.updateMany({
            where: { id: { in: ids } },
            data: { fieldName: renamed },
          });
        }
      }
      return tx.assemblyField.update({ where: { id: fieldId }, data });
    });
    return this.fieldView(id, process.name, updated);
  }

  async removeField(companyId: string, id: string, fieldId: string) {
    const process = await this.processForWrite(companyId, id);
    const field = process.fields.find((item) => item.id === fieldId);
    if (!field) throw new NotFoundException(FIELD_NOT_FOUND);
    const { usedBy } = await this.fieldView(id, process.name, field);
    if (usedBy.length) bad(FIELD_IN_USE(usedBy));
    await this.prisma.assemblyField.delete({ where: { id: fieldId } });
  }

  /* ---------------------------------------------------------------- fórmulas */

  async addFormula(companyId: string, id: string, dto: CreateFormulaDto) {
    const row = await this.findProcess(companyId, id);
    const name = dto.name.trim();
    if (!name) bad('Dê um nome à fórmula');
    const error = await this.formulaError(companyId, row, dto.expression);
    if (error) bad(error);
    if (findByName(row.formulas, name)) {
      bad('Já existe uma fórmula com esse nome neste produto');
    }

    const formula = await this.prisma.assemblyFormula.create({
      data: { processId: id, name, expression: dto.expression.trim() },
    });
    return {
      id: formula.id,
      name: formula.name,
      expression: formula.expression,
      usedBy: [] as string[],
      error: null,
    };
  }

  async updateFormula(
    companyId: string,
    id: string,
    formulaId: string,
    dto: UpdateFormulaDto,
  ) {
    const row = await this.findProcess(companyId, id);
    const formula = row.formulas.find((item) => item.id === formulaId);
    if (!formula) throw new NotFoundException(FORMULA_NOT_FOUND);

    const data: Prisma.AssemblyFormulaUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) bad('Dê um nome à fórmula');
      const other = findByName(row.formulas, name);
      if (other && other.id !== formulaId) {
        bad('Já existe uma fórmula com esse nome neste produto');
      }
      data.name = name;
    }
    if (dto.expression !== undefined) {
      const error = await this.formulaError(companyId, row, dto.expression);
      if (error) bad(error);
      data.expression = dto.expression.trim();
    }

    const updated = await this.prisma.assemblyFormula.update({
      where: { id: formulaId },
      data,
    });
    const used = row.lines.some(
      (line) => line.formula === 'CUSTOM' && line.formulaId === formulaId,
    );
    return {
      id: updated.id,
      name: updated.name,
      expression: updated.expression,
      usedBy: used ? [row.name] : [],
      error: null,
    };
  }

  async removeFormula(companyId: string, id: string, formulaId: string) {
    const row = await this.findProcess(companyId, id);
    if (!row.formulas.some((item) => item.id === formulaId)) {
      throw new NotFoundException(FORMULA_NOT_FOUND);
    }
    if (
      row.lines.some(
        (line) => line.formula === 'CUSTOM' && line.formulaId === formulaId,
      )
    ) {
      bad(FORMULA_IN_USE([row.name]));
    }
    // A linha que um produto ajustou guarda a fórmula do processo (CP-21)
    const adjusted = await this.prisma.assemblyLine.findMany({
      where: {
        formula: 'CUSTOM',
        formulaId,
        block: {
          processId: id,
          assembly: { companyId, productId: { not: null } },
        },
      },
      select: {
        block: {
          select: {
            assembly: { select: { product: { select: { name: true } } } },
          },
        },
      },
    });
    if (adjusted.length) {
      bad(
        FORMULA_IN_USE([
          ...new Set(adjusted.map((line) => line.block!.assembly.product.name)),
        ]),
      );
    }
    await this.prisma.assemblyFormula.delete({ where: { id: formulaId } });
  }

  /* ---------------------------------------------------------------- apoio */

  /** Quantos produtos a mudança no processo alcança (CP-21). */
  async affectedProducts(companyId: string, processId: string) {
    const linked = await this.linkedProducts(companyId, [processId]);
    return linked.get(processId)?.size ?? 0;
  }

  /**
   * Os produtos com etapa ligada a cada processo, um por produto: a
   * composição padrão e as próprias das variações contam juntas.
   */
  private async linkedProducts(companyId: string, processIds: string[]) {
    const byProcess = new Map<string, Map<string, string>>();
    if (!processIds.length) return byProcess;
    const blocks = await this.prisma.assemblyBlock.findMany({
      where: {
        processId: { in: processIds },
        assembly: { companyId, productId: { not: null } },
      },
      select: {
        processId: true,
        assembly: {
          select: { productId: true, product: { select: { name: true } } },
        },
      },
    });
    for (const block of blocks) {
      const products = byProcess.get(block.processId!) ?? new Map();
      products.set(block.assembly.productId, block.assembly.product.name);
      byProcess.set(block.processId!, products);
    }
    return byProcess;
  }

  private header(row: ProcessRow) {
    return {
      id: row.id,
      name: row.name,
      sectorId: row.sectorId,
      sector: row.sector.name,
      afterBase: row.afterBase,
      setupMinutes: row.setupMinutes,
      taskType: row.taskType,
      sellerInstructions: row.sellerInstructions,
      isActive: row.isActive,
      category: categoryOf(row),
      rules: rulesOf(row.rules),
    };
  }

  private async findProcess(companyId: string, id: string) {
    const row = await this.prisma.process.findFirst({
      where: { id, companyId },
      include: PROCESS_INCLUDE,
    });
    if (!row) throw new NotFoundException(PROCESS_NOT_FOUND);
    return row;
  }

  /** O que as escritas conferem: setor, campos e fórmulas do processo. */
  private async processForWrite(companyId: string, id: string) {
    const row = await this.prisma.process.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        name: true,
        sector: { select: { saleUnit: true } },
        fields: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        formulas: { select: { id: true } },
      },
    });
    if (!row) throw new NotFoundException(PROCESS_NOT_FOUND);
    return row;
  }

  private async findLine(processId: string, lineId: string) {
    const row = await this.prisma.assemblyLine.findFirst({
      where: { id: lineId, processId },
      include: LINE_INCLUDE,
    });
    if (!row) throw new NotFoundException(LINE_NOT_FOUND);
    return row;
  }

  private async activeSector(companyId: string, sectorId: string) {
    const sector = await this.prisma.companySector.findFirst({
      where: { id: sectorId, companyId, isActive: true },
      select: { id: true, name: true },
    });
    if (!sector) bad(SECTOR_REQUIRED);
    return sector!;
  }

  /**
   * O campo que a linha lê existe no processo (IP-4): o mesmo nome, sem
   * acento e sem maiúscula, é o mesmo campo. Devolve o nome gravado.
   */
  private async ensureField(
    tx: Prisma.TransactionClient,
    process: { id: string; fields: { id: string; name: string }[] },
    name: string,
    defaultValue = 0,
  ) {
    const found = findByName(process.fields, name);
    if (found) return found.name;
    await tx.assemblyField.create({
      data: {
        processId: process.id,
        name,
        defaultValue,
        allowsFraction: !Number.isInteger(defaultValue),
      },
    });
    return name;
  }

  /** Em que etapa o campo é lido: a linha que aponta ou a fórmula que cita. */
  private async fieldView(
    processId: string,
    processName: string,
    field: {
      id: string;
      name: string;
      defaultValue: number;
      allowsFraction: boolean;
    },
  ) {
    const [lines, formulas] = await Promise.all([
      this.prisma.assemblyLine.findMany({
        where: { processId },
        select: { fieldName: true, formula: true, formulaId: true },
      }),
      this.prisma.assemblyFormula.findMany({
        where: { processId },
        select: { id: true, expression: true },
      }),
    ]);
    const used = lines.some((line) => {
      if (
        line.fieldName &&
        normalizeName(line.fieldName) === normalizeName(field.name)
      ) {
        return true;
      }
      if (line.formula !== 'CUSTOM' || !line.formulaId) return false;
      const formula = formulas.find((item) => item.id === line.formulaId);
      return !!formula && formulaUsesName(formula.expression, field.name);
    });
    return {
      id: field.id,
      name: field.name,
      defaultValue: field.defaultValue,
      allowsFraction: field.allowsFraction,
      usedBy: used ? [processName] : [],
    };
  }

  /**
   * O erro da fórmula na medida padrão do processo, com os campos e as
   * referências de material das linhas.
   */
  private async formulaError(
    companyId: string,
    row: ProcessRow,
    expression: string,
  ) {
    const resources = await this.resources.resolve(
      companyId,
      resourceIdsOf(row.lines),
    );
    const assembly = engineAssemblyOf(row, resources, DEFAULT_MEASURE, null);
    return evaluateFormula(
      expression,
      formulaVars(
        fieldsWithImplied(assembly),
        assembly.blocks,
        assembly.measure,
        0,
      ),
    ).error;
  }
}
