import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { PricingParametersService } from '../pricing/pricing-parameters.service';
import {
  AssemblyRow,
  EngineBuilder,
  ProductRow,
  assemblyFormulas,
  engineVariation,
  productPricing,
} from './assembly-graph';
import { measureMm } from './assembly-view';
import {
  FIELD_NOT_FOUND,
  LINE_NOT_FOUND,
  OPTION_NOT_FOUND,
} from './composition-lines';
import { SaleChoicesDto, SaleCompositionDto } from './dto/sale.dto';
import { computeAssembly, orderBlocks } from './engine/compute';
import { formulaUsesName, normalizeName } from './engine/formula';
import {
  EngineAssembly,
  EngineBlock,
  EngineLine,
  Measure,
} from './engine/types';
import {
  BLOCK_NOT_FOUND,
  ProductAssemblyService,
} from './product-assembly.service';

const NOT_FOR_SALE = 'Este produto não está liberado para venda';
const TIME_FORMULAS = ['PER_TIME', 'EQUAL_TIME', 'TIME_TIMES_EXTRA'];

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const minutesText = (minutes: number) =>
  `${Math.floor(minutes / 60)}h${String(Math.round(minutes % 60)).padStart(2, '0')}`;

const numberText = (value: number) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const stageOf = (block: EngineBlock) => block.localName || block.name;
const rulesOf = (block: EngineBlock) => block.localRules ?? block.originalRules;
const hasTimeLine = (block: EngineBlock) =>
  block.lines.some((line) => TIME_FORMULAS.includes(line.formula));

/**
 * O produto na venda (IP-36): o formulário do vendedor e o relatório da
 * composição daquela venda. Nenhuma das duas devolve custo, nem preço por
 * linha ou por recurso (ORC-7, SEG-6); a única exceção é a venda sugerida da
 * etapa no relatório, que a proposta usa para repartir o valor do item.
 */
@Injectable()
export class ProductSaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assemblies: ProductAssemblyService,
    private readonly pricing: PricingParametersService,
  ) {}

  /** As escolhas do produto no item do orçamento; nulo sem composição. */
  async saleForm(companyId: string, productId: string, variationId?: string) {
    const { product, assembly, builder } = await this.load(
      companyId,
      productId,
      variationId,
    );
    if (!assembly?.blocks.length) return null;
    // Inativo, em edição ou só parte: não é vendável (IP-14, PAD-7)
    if (!product.isActive || assembly.status !== 'RELEASED') bad(NOT_FOR_SALE);

    const engine = builder.build(
      product,
      assembly,
      productPricing(product).measure,
    );
    const rows = new Map(assembly.blocks.map((block) => [block.id, block]));
    const blocks = orderBlocks(engine.blocks);
    const formulas = assemblyFormulas(assembly);
    const reads = (name: string) =>
      engine.blocks.some((block) =>
        block.lines.some((line) => {
          if (
            line.fieldName &&
            normalizeName(line.fieldName) === normalizeName(name)
          ) {
            return true;
          }
          if (line.formula !== 'CUSTOM' || !line.formulaId) return false;
          const formula = formulas.find((item) => item.id === line.formulaId);
          return !!formula && formulaUsesName(formula.expression, name);
        }),
      );

    const form = {
      stages: blocks.map((block) => ({
        blockId: block.id,
        name: stageOf(block),
        sector: block.sector,
      })),
      // Os campos lidos por alguma linha, uma vez só (IP-6); inteiro por
      // padrão, com fração quando o campo aceita (IP-19)
      extras: (engine.fields ?? [])
        .filter((field) => reads(field.name))
        .map((field) => ({
          fieldId: field.id,
          name: field.name,
          kind: field.allowsFraction ? 'DECIMAL' : 'INTEGER',
          defaultValue: field.defaultValue,
        })) as {
        fieldId: string;
        name: string;
        kind: string;
        defaultValue: number;
      }[],
      times: [] as { blockId: string; name: string; defaultMinutes: number }[],
      choices: [] as unknown[],
      optionals: [] as unknown[],
      lists: [] as unknown[],
      instructions: [] as { blockId: string; stage: string; text: string }[],
      requiresMeasure: this.requiresMeasure(product),
    };

    for (const block of blocks) {
      const stage = stageOf(block);
      const rules = rulesOf(block);
      // As instruções ao vendedor do processo da etapa (CP-13)
      const text = rows.get(block.id)?.process?.sellerInstructions?.trim();
      if (text) form.instructions.push({ blockId: block.id, stage, text });

      if (rules.timeField || hasTimeLine(block)) {
        const timeLine = block.lines.find((line) =>
          TIME_FORMULAS.includes(line.formula),
        );
        form.times.push({
          blockId: block.id,
          name: `Tempo · ${stage}`,
          defaultMinutes: rules.timeFieldDefault || timeLine?.perUnit || 0,
        });
      }
      // Legado: a etapa com campo extra próprio e nenhuma linha lendo um
      // campo do produto
      if (
        rules.extraField !== 'NONE' &&
        !block.lines.some((line) => line.fieldName)
      ) {
        form.extras.push({
          fieldId: `block:${block.id}`,
          name: rules.extraFieldName || stage,
          kind: rules.extraField,
          defaultValue: rules.extraFieldDefault,
        });
      }

      for (const line of block.lines) {
        // Linha sem recurso é erro de cadastro: não chega à venda (IP-37)
        if (!line.options.length) continue;
        const ref = {
          blockId: block.id,
          lineId: line.id,
          name: line.name,
          stage,
        };
        if (line.optional) {
          form.optionals.push({
            ...ref,
            defaultIncluded: !!line.optionalDefault,
          });
        }
        if (line.mode === 'CHOOSE') {
          form.choices.push({
            ...ref,
            defaultId: line.selectedId || line.options[0].id,
            options: line.options.map(({ id, name }) => ({ id, name })),
          });
        }
        if (line.mode === 'LIST') {
          form.lists.push({
            ...ref,
            options: line.options.map(({ id, name, unit }) => ({
              id,
              name,
              unit,
            })),
          });
        }
      }
    }
    return form;
  }

  /**
   * O relatório da composição daquela venda: aplica as escolhas numa cópia,
   * roda o motor e devolve o que vai ser feito, sem custo. Não grava nada.
   */
  async saleComposition(
    companyId: string,
    productId: string,
    dto: SaleCompositionDto,
  ) {
    const { product, variation, assembly, builder, graph } = await this.load(
      companyId,
      productId,
      dto.variationId ?? undefined,
    );
    if (!assembly?.blocks.length) bad('Este produto não tem composição');
    if (
      this.requiresMeasure(product) &&
      !(dto.measure?.width && dto.measure?.height)
    ) {
      bad('Informe a medida do item');
    }
    // Vendido por unidade, vale a quantidade informada na medida padrão
    const standard = productPricing(product).measure;
    const measure: Measure = dto.measure
      ? {
          quantity: dto.measure.quantity,
          width: dto.measure.width || standard.width,
          height: dto.measure.height || standard.height,
        }
      : standard;
    const engine = builder.build(product, assembly, measure);
    this.applyChoices(engine, dto);

    const markup = await this.pricing.referenceMarkupOf(companyId);
    const computed = computeAssembly(
      engine,
      {
        referenceMarkup: markup,
        partOf: builder.partOf,
        resourceName: (id) => graph.resources.get(id)?.name,
      },
      engineVariation(variation),
    );
    const rows = new Map(assembly!.blocks.map((block) => [block.id, block]));
    const fields = engine.fields ?? [];
    const detail = await this.prisma.product.findUnique({
      where: { id: product.id },
      select: { technicalDescription: true },
    });

    return {
      name: product.name,
      technicalDescription: detail?.technicalDescription ?? '',
      measure,
      variation: variation?.name ?? null,
      blocks: computed.blocks.map((block) => {
        const row = rows.get(block.id);
        const rules = block.rules;
        const fieldNames = [
          ...new Set(
            block.lines
              .filter((line) => line.fieldName)
              .map((line) => line.fieldName!),
          ),
        ];
        const extra = [
          rules.timeField
            ? `tempo ${minutesText(rules.timeFieldDefault || 0)}`
            : null,
          rules.extraField === 'NONE' || fieldNames.length
            ? null
            : `${rules.extraFieldName}: ${numberText(rules.extraFieldDefault)}`,
          ...fieldNames.map((name) => {
            const field = fields.find(
              (item) => normalizeName(item.name) === normalizeName(name),
            );
            return `${name}: ${numberText(field?.defaultValue ?? 0)}`;
          }),
        ]
          .filter(Boolean)
          .join(' · ');
        const base = computed.blocks.find(
          (item) => item.id === block.baseBlockId,
        );
        return {
          id: block.id,
          name: stageOf(block),
          sector: block.sector,
          taskType:
            row?.type === 'PROCESS' && row.process
              ? (row.localTaskType ?? row.process.taskType)
              : (row?.taskType ?? ''),
          role: block.dependsOn.length ? 'FINISHING' : 'BASE',
          baseName: base ? stageOf(base) : null,
          measure: measureMm(block.measure),
          extra: extra || null,
          note:
            dto.notes?.find((item) => item.blockId === block.id)?.text.trim() ||
            null,
          // O preparo da parte entra junto (GP-16)
          setupMinutes: block.setupMinutes + block.partSetupMinutes,
          sale: block.sale,
          lines: [...block.partLines, ...block.lines].map((line) => ({
            id: line.id,
            name: line.name,
            kind: line.kind,
            resource:
              line.mode === 'LIST' ? null : (line.selected?.name ?? null),
            quantity: line.quantity,
            unit: line.selected?.unit || line.options[0]?.unit || '',
            entries:
              line.mode === 'LIST'
                ? line.options
                    .map((option) => ({
                      name: option.name,
                      unit: option.unit,
                      quantity:
                        dto.lists?.find(
                          (item) =>
                            item.blockId === block.id &&
                            item.lineId === line.id &&
                            item.optionId === option.id,
                        )?.quantity || 0,
                    }))
                    .filter((entry) => entry.quantity > 0)
                : null,
            // Só na linha da própria folha ou chapa (AP-5)
            sheetYield: line.selected?.sheet ? line.sheetYield : null,
          })),
        };
      }),
    };
  }

  /**
   * A composição escolhida no item do orçamento (IP-36) e o retrato da
   * venda (ORC-10): aplica as escolhas na medida do item e guarda o custo
   * e a venda de cada etapa e de cada linha. O retrato tem custo: fica no
   * item e nunca sai para a tela do orçamento (ORC-7).
   */
  async itemComposition(
    companyId: string,
    productId: string,
    variationId: string | null | undefined,
    // A medida do item em mm; a que faltar vem do padrão do produto
    itemMeasure: { quantity: number; width?: number; height?: number },
    choices: SaleChoicesDto,
  ) {
    const { product, variation, assembly, builder, graph } = await this.load(
      companyId,
      productId,
      variationId ?? undefined,
    );
    if (
      !assembly?.blocks.length ||
      assembly.status !== 'RELEASED' ||
      !product.isActive
    ) {
      bad(NOT_FOR_SALE);
    }
    // Na lista, o vendedor informa quanto vai de cada item (IP-8)
    if ((choices.lists ?? []).some((entry) => !(entry.quantity > 0))) {
      bad('Informe a quantidade de cada item da lista');
    }

    const standard = productPricing(product).measure;
    const measure: Measure = {
      quantity: itemMeasure.quantity || 1,
      width: itemMeasure.width || standard.width,
      height: itemMeasure.height || standard.height,
    };
    const engine = builder.build(product, assembly, measure);
    // Os nomes antes de a cópia perder a opcional desmarcada
    const lines = new Map(
      engine.blocks.flatMap((block) =>
        block.lines.map((line) => [`${block.id}:${line.id}`, line] as const),
      ),
    );
    this.applyChoices(engine, choices);
    const computed = computeAssembly(
      engine,
      {
        referenceMarkup: await this.pricing.referenceMarkupOf(companyId),
        partOf: builder.partOf,
        resourceName: (id) => graph.resources.get(id)?.name,
      },
      engineVariation(variation),
    );

    const optionName = (blockId: string, lineId: string, optionId: string) =>
      lines
        .get(`${blockId}:${lineId}`)
        ?.options.find((option) => option.id === optionId)?.name;
    const blockOf = (blockId: string) =>
      engine.blocks.find((block) => block.id === blockId);
    // O campo do produto, ou o campo extra legado da etapa ("block:<id>")
    const extraName = (fieldId: string) => {
      if (fieldId.startsWith('block:')) {
        const block = blockOf(fieldId.slice('block:'.length));
        return block ? rulesOf(block).extraFieldName || stageOf(block) : null;
      }
      return engine.fields?.find((field) => field.id === fieldId)?.name;
    };
    // O resumo do que foi escolhido, para a lista de itens (IP-36)
    const summary = [
      ...(choices.times ?? []).map((item) => {
        const block = blockOf(item.blockId);
        return block
          ? `Tempo · ${stageOf(block)}: ${minutesText(item.minutes)}`
          : null;
      }),
      ...(choices.extras ?? []).map((item) => {
        const name = extraName(item.fieldId);
        return name ? `${name}: ${numberText(item.value)}` : null;
      }),
      ...(choices.choices ?? []).map((item) =>
        optionName(item.blockId, item.lineId, item.optionId),
      ),
      ...(choices.lists ?? []).map((item) => {
        const name = optionName(item.blockId, item.lineId, item.optionId);
        return name ? `${name}: ${numberText(item.quantity)}` : null;
      }),
      ...(choices.optionals ?? [])
        .filter((item) => item.included)
        .map((item) => lines.get(`${item.blockId}:${item.lineId}`)?.name),
    ].filter((item): item is string => !!item);

    // As entradas da lista entram no retrato pelo custo do recurso
    const listEntries = (blockId: string, lineId: string) =>
      (choices.lists ?? [])
        .filter((item) => item.blockId === blockId && item.lineId === lineId)
        .map((item) => {
          const option = lines
            .get(`${blockId}:${lineId}`)
            ?.options.find((entry) => entry.id === item.optionId);
          const unitCost = option?.unitCost ?? 0;
          return {
            optionId: item.optionId,
            resourceId: option?.resourceId ?? null,
            name: option?.name ?? '',
            unit: option?.unit ?? '',
            quantity: item.quantity,
            unitCost,
            cost: Math.round(unitCost * item.quantity),
          };
        });
    const stages = computed.blocks.map((block) => {
      const stageLines = [...block.partLines, ...block.lines].map((line) => {
        const entries =
          line.mode === 'LIST' ? listEntries(block.id, line.id) : null;
        return {
          lineId: line.id,
          name: line.name,
          kind: line.kind,
          resourceId: line.selected?.resourceId ?? null,
          resource: line.selected?.name ?? null,
          quantity: line.quantity,
          unit: line.selected?.unit ?? line.options[0]?.unit ?? '',
          unitCost: line.selected?.unitCost ?? null,
          cost: entries
            ? entries.reduce((sum, entry) => sum + entry.cost, 0)
            : line.cost,
          sale: line.sale,
          entries,
          // O apontamento da produção preenche depois (ORC-9)
          actualQuantity: null,
          actualCost: null,
        };
      });
      const listCost = stageLines
        .filter((line) => line.entries)
        .reduce((sum, line) => sum + (line.cost ?? 0), 0);
      return {
        blockId: block.id,
        name: stageOf(block),
        sector: block.sector,
        setupMinutes: block.setupMinutes + block.partSetupMinutes,
        setupCost: block.setupCost,
        cost: block.cost + listCost,
        sale: block.sale,
        lines: stageLines,
      };
    });

    return {
      composition: {
        extras: choices.extras ?? [],
        times: choices.times ?? [],
        choices: choices.choices ?? [],
        optionals: choices.optionals ?? [],
        lists: choices.lists ?? [],
        notes: choices.notes ?? [],
        summary,
      },
      snapshot: {
        computedAt: new Date().toISOString(),
        measure,
        variationId: variation?.id ?? null,
        cost: stages.reduce((sum, stage) => sum + stage.cost, 0),
        suggestedPrice: computed.suggestedPrice,
        stages,
      },
    };
  }

  /* ------------------------------------------------------------------ apoio */

  private async load(
    companyId: string,
    productId: string,
    variationId?: string,
  ) {
    const product = await this.assemblies.product({ companyId, productId });
    const variation = this.assemblies.variationOf(product, variationId);
    const key = variation?.assemblies.length ? variation.id : '';
    const assembly: AssemblyRow | null = await this.assemblies.assemblyRow(
      product.id,
      key,
    );
    const graph = await this.assemblies.loadGraph(companyId, [assembly]);
    return {
      product,
      variation,
      assembly,
      graph,
      builder: new EngineBuilder(graph),
    };
  }

  /** Sem medida padrão no cadastro, a venda informa a medida (IP-15, IP-16). */
  private requiresMeasure(product: ProductRow) {
    const item = product.items[0];
    return item?.unitKind === 'AREA' && !(item.width && item.height);
  }

  /** As escolhas do vendedor numa cópia, só para esta venda. */
  private applyChoices(engine: EngineAssembly, dto: SaleCompositionDto) {
    const blockOf = (blockId: string) => {
      const block = engine.blocks.find((item) => item.id === blockId);
      if (!block) throw new NotFoundException(BLOCK_NOT_FOUND);
      return block;
    };
    const lineOf = (blockId: string, lineId: string): EngineLine => {
      const line = blockOf(blockId).lines.find((item) => item.id === lineId);
      if (!line) throw new NotFoundException(LINE_NOT_FOUND);
      return line;
    };
    const optionOf = (line: EngineLine, optionId: string) => {
      if (!line.options.some((option) => option.id === optionId)) {
        throw new NotFoundException(OPTION_NOT_FOUND);
      }
    };
    const withRules = (block: EngineBlock, patch: object) => {
      block.localRules = { ...rulesOf(block), ...patch };
    };

    for (const item of dto.extras ?? []) {
      if (item.fieldId.startsWith('block:')) {
        const block = blockOf(item.fieldId.slice('block:'.length));
        if (
          rulesOf(block).extraField === 'INTEGER' &&
          !Number.isInteger(item.value)
        ) {
          bad('Só número inteiro');
        }
        withRules(block, { extraFieldDefault: item.value });
        continue;
      }
      const field = (engine.fields ?? []).find((f) => f.id === item.fieldId);
      if (!field) throw new NotFoundException(FIELD_NOT_FOUND);
      // Campo inteiro recusa decimal (IP-19)
      if (!field.allowsFraction && !Number.isInteger(item.value)) {
        bad('Só número inteiro');
      }
      field.defaultValue = item.value;
    }
    for (const item of dto.times ?? []) {
      withRules(blockOf(item.blockId), { timeFieldDefault: item.minutes });
    }
    for (const item of dto.choices ?? []) {
      const line = lineOf(item.blockId, item.lineId);
      optionOf(line, item.optionId);
      line.selectedId = item.optionId;
    }
    for (const item of dto.optionals ?? []) {
      lineOf(item.blockId, item.lineId).optionalDefault = item.included;
    }
    for (const item of dto.lists ?? []) {
      optionOf(lineOf(item.blockId, item.lineId), item.optionId);
    }
    for (const item of dto.notes ?? []) blockOf(item.blockId);

    // O relatório mostra o que foi vendido: sem linha vazia e sem a
    // opcional que ficou de fora
    for (const block of engine.blocks) {
      block.lines = block.lines.filter(
        (line) =>
          line.options.length && (!line.optional || line.optionalDefault),
      );
    }
  }
}
