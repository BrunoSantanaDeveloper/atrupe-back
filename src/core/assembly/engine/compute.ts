import { evaluateFormula, formulaUsesName, FormulaVars } from './formula';
import {
  ComputedAssembly,
  ComputedBlock,
  ComputedLine,
  EngineAssembly,
  EngineBlock,
  EngineDeps,
  EngineLine,
  EngineOption,
  EngineVariation,
  FlowStage,
  Measure,
  PriceTier,
  QuoteField,
  ResourceSummary,
  SheetYield,
} from './types';

/**
 * O motor da composição (SEG-1): o mesmo cálculo do mock do front
 * (app-web, actions/product-assembly.ts › compute), com a mesma ordem de
 * arredondamento. Os casos de referência dos testes saem do próprio mock.
 *
 * É puro: recebe a composição já montada (as etapas de processo fundidas com
 * o que o produto ajustou, as opções com custo e venda resolvidos) e devolve
 * o resultado. Quem lê o banco e quem grava ficam fora daqui.
 */

/** Partes dentro de partes: no máximo três níveis (IP-9). */
const MAX_PART_DEPTH = 3;

export const round = (value: number, digits = 2) =>
  Math.round(value * 10 ** digits) / 10 ** digits;

export const lineQuantity = (
  line: Pick<EngineLine, 'formula' | 'perUnit'>,
  measure: Measure,
  extra: number,
  // Campo tempo da etapa, em minutos; sem ele, o consumo faz o papel (IP-32)
  time: number | null = null,
): number | null => {
  const { quantity: n, width: w, height: h } = measure;
  const area = w * h;
  const perimeter = 2 * (w + h);
  const k = line.perUnit;

  switch (line.formula) {
    case 'FIXED':
      return k;
    case 'SELLER':
      return null;
    case 'PER_AREA':
      return k * area * n;
    case 'PER_UNIT':
      return k * n;
    case 'PER_PERIMETER':
      return k * perimeter * n;
    case 'PER_WIDTH':
      return k * w * n;
    case 'PER_HEIGHT':
      return k * h * n;
    case 'PER_EXTRA':
      return k * extra * n;
    // As três do campo tempo, como no legado (11, 12 e 13)
    case 'PER_TIME':
      return time === null ? k * n : time * n;
    case 'PER_PERIMETER_DIV_EXTRA':
      // Quantos cabem no perímetro: nunca fração de ilhós
      return extra > 0 ? Math.ceil(perimeter / extra) * k * n : null;
    case 'TIME_TIMES_EXTRA':
      return time === null ? k * extra : k * time * extra;
    case 'EQUAL_TIME':
      return time === null ? k : time;
    case 'PER_WIDTH_EXTRA':
      return k * w * extra * n;
    case 'PER_HEIGHT_EXTRA':
      return k * h * extra * n;
    case 'EXTRA_ONLY':
      return k * extra;
    case 'PER_AREA_DIV_EXTRA':
      return extra > 0 ? (k * area * n) / extra : null;
    case 'PER_PERIMETER_EXTRA':
      return k * perimeter * extra * n;
    case 'DIV_EXTRA':
      return extra > 0 ? k / extra : null;
    case 'AREA_EXTRA':
      return k * area * extra;
    case 'PER_AREA_EXTRA':
      return k * area * extra * n;
    default:
      return null;
  }
};

/**
 * Quantas peças cabem na folha numa posição (AP-1), com margem na borda e
 * espaçamento entre peças (AP-3), em metros.
 */
export const fitCount = (
  sheetW: number,
  sheetH: number,
  pieceW: number,
  pieceH: number,
  margin = 0,
  gap = 0,
) => {
  const usableW = sheetW - 2 * margin;
  const usableH = sheetH - 2 * margin;
  if (pieceW <= 0 || pieceH <= 0 || usableW <= 0 || usableH <= 0) return 0;
  return (
    Math.floor((usableW + gap) / (pieceW + gap) + 1e-9) *
    Math.floor((usableH + gap) / (pieceH + gap) + 1e-9)
  );
};

/** Folhas necessárias, testando as duas posições da peça (AP-1 a AP-4). */
export const sheetYieldOf = (
  option: EngineOption,
  pieceW: number,
  pieceH: number,
  pieces: number,
  settings: { marginMm?: number; gapMm?: number; wholeSheets?: boolean } = {},
): SheetYield | null => {
  if (!option.sheet) return null;
  const { width, height } = option.sheet;
  const marginMm = settings.marginMm || 0;
  const gapMm = settings.gapMm || 0;
  const margin = marginMm / 1000;
  const gap = gapMm / 1000;
  const firstFit = fitCount(width, height, pieceW, pieceH, margin, gap);
  const secondFit = fitCount(width, height, pieceH, pieceW, margin, gap);
  const perSheet = Math.max(firstFit, secondFit);
  const sheets = perSheet ? Math.ceil(pieces / perSheet) : 0;
  return {
    sheetName: option.name,
    firstFit,
    secondFit,
    perSheet,
    sheets,
    leftover: sheets * perSheet - pieces,
    // Padrão: cobra a folha inteira, porque a sobra raramente se aproveita
    charged:
      settings.wholeSheets === false && perSheet
        ? round(pieces / perSheet, 3)
        : sheets,
    marginMm,
    gapMm,
  };
};

/** A faixa vale para o total da venda (FQ-2): a maior que a quantidade alcança. */
export const tierFor = (tiers: PriceTier[], quantity: number) =>
  [...tiers]
    .sort((a, b) => b.from - a.from)
    .find((tier) => quantity >= tier.from) || null;

/**
 * As etapas na ordem do fluxo (FL-1): toda etapa vem depois das que ela
 * depende e, entre as que já podem entrar, vale a ordem em que estão.
 */
export const orderBlocks = <T extends Pick<EngineBlock, 'id' | 'dependsOn'>>(
  blocks: T[],
): T[] => {
  const ids = new Set(blocks.map((block) => block.id));
  const done = new Set<string>();
  const result: T[] = [];
  let pending = [...blocks];
  while (pending.length) {
    const ready = pending.filter((block) =>
      block.dependsOn.every((id) => !ids.has(id) || done.has(id)),
    );
    // Um laço não deveria existir; se existir, segue a ordem gravada
    const batch = ready.length ? ready : [pending[0]];
    batch.forEach((block) => {
      done.add(block.id);
      result.push(block);
    });
    pending = pending.filter((block) => !done.has(block.id));
  }
  return result;
};

const fieldKey = (name: string) => name.trim().toLowerCase();

const findField = (fields: QuoteField[], name: string) =>
  fields.find((field) => fieldKey(field.name) === fieldKey(name));

/**
 * Os campos do orçamento, com os que as linhas leem e o produto ainda não
 * declarou (o padrão vem do campo extra legado da etapa).
 */
export const fieldsWithImplied = (assembly: EngineAssembly): QuoteField[] => {
  const fields = [...(assembly.fields || [])];
  assembly.blocks.forEach((block) => {
    const rules = block.localRules ?? block.originalRules;
    block.lines.forEach((line) => {
      if (!line.fieldName || findField(fields, line.fieldName)) return;
      fields.push({
        id: `implied:${fieldKey(line.fieldName)}`,
        name: line.fieldName.trim(),
        defaultValue: rules.extraField === 'NONE' ? 0 : rules.extraFieldDefault,
      });
    });
  });
  return fields;
};

const selectedOf = (line: EngineLine) =>
  line.options.find((option) => option.id === line.selectedId) ||
  line.options[0];

/**
 * As referências do material escolhido em cada linha (MT-10.1, CP-18):
 * "montante · X" e "montante · Y" em metros, a folha e o peso.
 */
const lineRefVars = (blocks: EngineBlock[]): FormulaVars => {
  const vars: FormulaVars = {};
  blocks.forEach((block) =>
    block.lines.forEach((line) => {
      const selected = selectedOf(line);
      if (!selected) return;
      if (selected.profile) {
        vars[`${line.name} · X`] = selected.profile.x / 1000;
        vars[`${line.name} · Y`] = selected.profile.y / 1000;
      }
      if (selected.sheet) {
        vars[`${line.name} · largura`] = selected.sheet.width;
        vars[`${line.name} · altura`] = selected.sheet.height;
      }
      if (selected.weight) vars[`${line.name} · peso`] = selected.weight;
    }),
  );
  return vars;
};

/** O que a fórmula pode ler nesta etapa: medidas, tempo, campos e referências. */
export const formulaVars = (
  fields: QuoteField[],
  blocks: EngineBlock[],
  measure: Measure,
  time: number | null,
  block?: EngineBlock,
): FormulaVars => ({
  largura: measure.width,
  altura: measure.height,
  área: measure.width * measure.height,
  perímetro: 2 * (measure.width + measure.height),
  quantidade: measure.quantity,
  tempo: time ?? 0,
  ...Object.fromEntries(
    fields.map((field) => [field.name, field.defaultValue]),
  ),
  ...lineRefVars(block ? [block] : blocks),
});

const TIME_FORMULAS = ['PER_TIME', 'EQUAL_TIME', 'TIME_TIMES_EXTRA'];
const blockHasTimeLine = (block: EngineBlock) =>
  block.lines.some((line) => TIME_FORMULAS.includes(line.formula));

/** O fluxo como a tela desenha (FL-5), com as partes até três níveis (IP-9). */
export const flowOf = (
  assembly: EngineAssembly,
  deps: EngineDeps,
  depth = 0,
): FlowStage[] =>
  orderBlocks(assembly.blocks).map((block) => {
    const partSource = block.partProductId
      ? deps.partOf(block.partProductId)
      : null;
    return {
      id: block.id,
      name: block.localName || block.name,
      sector: block.sector,
      dependsOn: block.dependsOn,
      processId: block.processId,
      partProductId: block.partProductId ?? null,
      partFlow:
        partSource && depth < 2 ? flowOf(partSource, deps, depth + 1) : null,
    };
  });

/** O id da mão de obra do setor no resumo: o preparo entra como ela. */
export type LaborRef = { id: string; name: string };

export const computeAssembly = (
  assembly: EngineAssembly,
  deps: EngineDeps,
  variation: EngineVariation | null = null,
  // Parte dentro de parte tem limite: evita laço se alguém se incluir
  depth = 0,
  laborOf: (block: EngineBlock) => LaborRef = (block) => ({
    id: `mo-${block.sector}`,
    name: `Mão de obra · ${block.sector}`,
  }),
): ComputedAssembly => {
  const unitSaleOf = (option: EngineOption) =>
    option.unitSale ?? option.unitCost * deps.referenceMarkup;
  const fields = fieldsWithImplied(assembly);

  // Sem preço próprio, a variação vale o preço do produto (PV-4); com tabela
  // por faixa, vale a faixa da quantidade (FQ-1). A tabela própria da
  // variação (FQ-4) vale mais que o preço único dela
  const tiersFromVariation = !!variation?.priceTiers;
  const effectiveTiers = variation?.priceTiers ?? assembly.priceTiers;
  const tier = tierFor(effectiveTiers, assembly.measure.quantity);
  const unitPrice =
    (tiersFromVariation ? tier?.unitPrice : undefined) ??
    variation?.unitPrice ??
    tier?.unitPrice ??
    assembly.unitPrice;
  const { measure } = assembly;
  const area = round(measure.width * measure.height, 4);
  const blocks: ComputedBlock[] = [];
  // O consumo das partes entra no resumo do produto
  const partSummaries: ResourceSummary[][] = [];

  // Na ordem do fluxo: a etapa que usa a medida de outra vem depois dela
  for (const block of orderBlocks(assembly.blocks)) {
    const rules = block.localRules ?? block.originalRules;
    const base = blocks.find((item) => item.id === block.baseBlockId);
    const reference = base?.measure ?? measure;

    const size =
      rules.dimension === 'SAME_AS_PARENT'
        ? { width: reference.width, height: reference.height }
        : rules.dimension === 'NONE'
          ? { width: 0, height: 0 }
          : { width: measure.width, height: measure.height };

    const baseQuantity = rules.followsBase ? reference.quantity : 1;
    const quantity =
      rules.quantityMode === 'FREE'
        ? measure.quantity
        : rules.quantityMode === 'AREA_RATIO'
          ? Math.max(
              1,
              Math.floor(
                (reference.width * reference.height) /
                  Math.max(size.width * size.height, 0.0001),
              ),
            ) * baseQuantity
          : baseQuantity;

    // A etapa de medida fixa (a base simulada do processo, §9.1) ignora as
    // regras: a medida é a dela
    const blockMeasure = block.fixedMeasure ?? { quantity, ...size };
    const extra = rules.extraField === 'NONE' ? 0 : rules.extraFieldDefault;
    // O tempo é das linhas de mão de obra com tipo "tempo informado": sem
    // valor informado na venda, vale o consumo da linha (tempo padrão)
    const time =
      (rules.timeField || blockHasTimeLine(block)) && rules.timeFieldDefault
        ? rules.timeFieldDefault
        : null;

    const lines: ComputedLine[] = block.lines.map((line) => {
      const selected =
        line.mode === 'LIST'
          ? null
          : line.options.find((option) => option.id === line.selectedId) ||
            line.options[0] ||
            null;

      // Aproveitamento de folha (AP-1): as peças são a quantidade da etapa,
      // do tamanho da etapa; a folha vem da opção escolhida
      const referenceSheet =
        line.formula === 'SHEET_YIELD'
          ? selected?.sheet
            ? selected
            : block.lines
                .flatMap((item) => item.options)
                .find(
                  (option) =>
                    option.sheet &&
                    block.lines.some(
                      (item) =>
                        item.formula === 'SHEET_YIELD' &&
                        item.selectedId === option.id,
                    ),
                ) || null
          : null;
      // As regras da folha ficam na linha que escolhe a folha (AP-3, AP-4)
      const sheetLine = referenceSheet
        ? block.lines.find(
            (item) =>
              item.formula === 'SHEET_YIELD' &&
              item.options.some((option) => option.id === referenceSheet.id),
          ) || line
        : null;
      const sheetYield = referenceSheet
        ? sheetYieldOf(
            referenceSheet,
            blockMeasure.width,
            blockMeasure.height,
            blockMeasure.quantity,
            {
              marginMm: sheetLine?.sheetMargin,
              gapMm: sheetLine?.sheetGap,
              // A linha manda; sem escolha na linha, vale o material (AP-4)
              wholeSheets:
                sheetLine?.chargeWholeSheets ??
                referenceSheet.sheet?.wholeSheets,
            },
          )
        : null;

      // Consumo, perda e mínimo da opção escolhida, ou os da linha (IP-26)
      const own =
        !!selected &&
        (selected.perUnit !== undefined ||
          selected.lossPercent !== undefined ||
          selected.minimum !== undefined);
      const effective = {
        perUnit: selected?.perUnit ?? line.perUnit,
        lossPercent: selected?.lossPercent ?? line.lossPercent,
        minimum:
          selected?.minimum !== undefined ? selected.minimum : line.minimum,
        own,
      };
      const calcLine = { ...line, ...effective };

      // O campo do orçamento que esta linha lê (IP-4); sem ele, vale o campo
      // extra legado da etapa
      const lineExtra = line.fieldName
        ? (findField(fields, line.fieldName)?.defaultValue ?? extra)
        : extra;
      // A fórmula do produto (IP-2): consumo × o resultado dela nesta etapa
      const custom =
        line.formula === 'CUSTOM'
          ? (assembly.formulas || []).find(
              (item) => item.id === line.formulaId,
            ) || null
          : null;
      const customValue = custom
        ? evaluateFormula(
            custom.expression,
            formulaVars(fields, assembly.blocks, blockMeasure, time, block),
          ).value
        : null;
      // A lista é preenchida pelo vendedor (IP-8); a opcional desmarcada
      // fica fora da conta (IP-28)
      const raw =
        line.mode === 'LIST' || (line.optional && !line.optionalDefault)
          ? null
          : line.formula === 'CUSTOM'
            ? customValue === null
              ? null
              : customValue * calcLine.perUnit
            : line.formula === 'SHEET_YIELD'
              ? sheetYield
                ? sheetYield.charged * calcLine.perUnit
                : null
              : lineQuantity(calcLine, blockMeasure, lineExtra, time);

      // Pessoas na mão de obra (IP-13): duas pessoas por 30 minutos são 60
      // minutos de mão de obra
      const people =
        line.kind === 'LABOR' ? Math.max(1, Math.round(line.people || 1)) : 1;
      let qty =
        raw === null
          ? null
          : raw * people * (1 + (calcLine.lossPercent || 0) / 100);
      const minimumApplied =
        qty !== null && calcLine.minimum !== null && qty < calcLine.minimum;
      if (qty !== null && calcLine.minimum !== null) {
        qty = Math.max(qty, calcLine.minimum);
      }
      qty = qty === null ? null : round(qty, 3);

      return {
        ...line,
        people: line.kind === 'LABOR' ? people : undefined,
        sheetYield,
        extraValue:
          line.fieldName || rules.extraField !== 'NONE' ? lineExtra : null,
        formulaName: custom?.name ?? null,
        selected,
        quantity: qty,
        minimumApplied,
        effective,
        cost:
          qty === null || !selected
            ? null
            : Math.round(qty * selected.unitCost),
        sale:
          qty === null || !selected
            ? null
            : Math.round(qty * unitSaleOf(selected)),
      };
    });

    // O preparo entra uma vez por pedido (CP-15)
    const setupCost = Math.round(
      (block.setupMinutes * block.sectorHourCost) / 60,
    );
    const setupSale = Math.round(
      block.setupMinutes * (block.sectorHourSale / 60),
    );

    // A parte calcula a composição dela na medida desta etapa (IP-9)
    const partSource = block.partProductId
      ? deps.partOf(block.partProductId)
      : null;
    const part =
      partSource && depth < MAX_PART_DEPTH
        ? computeAssembly(
            { ...partSource, measure: blockMeasure },
            deps,
            null,
            depth + 1,
            laborOf,
          )
        : null;
    if (part) partSummaries.push(part.resourceSummary);

    blocks.push({
      ...block,
      processInactive: !!block.processInactive,
      partInactive: !!partSource?.inactive,
      part: part
        ? {
            productId: part.productId,
            name: part.name,
            stages: part.blocks.length,
          }
        : null,
      partFlow:
        partSource && depth < 2 ? flowOf(partSource, deps, depth + 1) : null,
      partLines: part
        ? part.blocks.flatMap((item) => [...item.partLines, ...item.lines])
        : [],
      partSetupMinutes: part
        ? part.blocks.reduce(
            (sum, item) => sum + item.setupMinutes + item.partSetupMinutes,
            0,
          )
        : 0,
      name: block.localName || block.name,
      rules,
      measure: blockMeasure,
      setupCost,
      setupSale,
      lines,
      cost:
        setupCost +
        (part?.cost || 0) +
        lines.reduce((sum, line) => sum + (line.cost || 0), 0),
      sale:
        setupSale +
        (part?.suggestedPrice || 0) +
        lines.reduce((sum, line) => sum + (line.sale || 0), 0),
    });
  }

  // Cada recurso uma vez, somado de todas as etapas (IP-34). O preparo entra
  // como mão de obra do setor
  const summary = new Map<string, ResourceSummary>();
  const addUse = (entry: ResourceSummary) => {
    const current = summary.get(entry.id);
    if (current) {
      current.quantity = round(current.quantity + entry.quantity, 3);
      current.cost += entry.cost;
      current.sale += entry.sale;
      if (entry.people) {
        current.people = Math.max(current.people || 1, entry.people);
      }
    } else {
      summary.set(entry.id, { ...entry });
    }
  };
  blocks.forEach((block) => {
    if (block.setupMinutes) {
      const labor = laborOf(block);
      addUse({
        id: labor.id,
        name: labor.name,
        kind: 'LABOR',
        unit: 'min',
        quantity: block.setupMinutes,
        cost: block.setupCost,
        sale: block.setupSale,
      });
    }
    block.lines.forEach((line) => {
      if (!line.selected || line.quantity === null) return;
      const resourceId = line.selected.resourceId || line.selected.id;
      addUse({
        id: resourceId,
        name: deps.resourceName?.(resourceId) || line.selected.name,
        kind: line.kind,
        unit: line.selected.unit,
        quantity: line.quantity,
        cost: line.cost || 0,
        sale: line.sale || 0,
        people: line.kind === 'LABOR' ? line.people : undefined,
      });
    });
  });
  partSummaries.flat().forEach(addUse);
  const resourceSummary = Array.from(summary.values());

  const cost = blocks.reduce((sum, block) => sum + block.cost, 0);
  // O sugerido é a soma do preço de venda de cada recurso, como no legado
  // (IP-25): cada recurso já traz a margem com que a empresa o vende
  const suggestedPrice = blocks.reduce((sum, block) => sum + block.sale, 0);

  // Quanto de unidade comercial a medida tem, como o "Valor" do START
  const saleAmount =
    assembly.unitKind === 'AREA'
      ? area * measure.quantity
      : assembly.unitKind === 'UNITY'
        ? measure.quantity
        : assembly.unitAmount * measure.quantity;

  const priceForMeasure =
    unitPrice === null || unitPrice === undefined
      ? null
      : Math.round(unitPrice * saleAmount);

  return {
    ...assembly,
    area,
    fields: fields.map((field) => ({
      ...field,
      usedBy: usedByField(assembly, field),
    })),
    formulas: (assembly.formulas || []).map((formula) => ({
      ...formula,
      usedBy: assembly.blocks
        .filter((block) =>
          block.lines.some(
            (line) =>
              line.formula === 'CUSTOM' && line.formulaId === formula.id,
          ),
        )
        .map((block) => block.localName || block.name),
      error: evaluateFormula(
        formula.expression,
        formulaVars(fields, assembly.blocks, assembly.measure, 0),
      ).error,
    })),
    blocks,
    resourceSummary,
    cost,
    suggestedPrice,
    saleAmount: round(saleAmount, 4),
    priceForMeasure,
    suggestedUnitPrice: Math.round(
      suggestedPrice / Math.max(saleAmount, 0.0001),
    ),
    activeVariation: variation,
    activeTier:
      tiersFromVariation || variation?.unitPrice == null ? tier : null,
    effectiveTiers,
    tiersFromVariation,
    // Produto sem composição nunca aparece com margem zero (DC-15)
    margin:
      priceForMeasure && cost
        ? round(((priceForMeasure - cost) / priceForMeasure) * 100, 1)
        : null,
  };
};

/**
 * Em que etapas o campo é lido: pela linha que aponta para ele ou pela
 * fórmula do produto que o cita.
 */
const usedByField = (assembly: EngineAssembly, field: QuoteField) =>
  assembly.blocks
    .filter((block) =>
      block.lines.some((line) => {
        if (line.fieldName && fieldKey(line.fieldName) === fieldKey(field.name))
          return true;
        if (line.formula !== 'CUSTOM' || !line.formulaId) return false;
        const formula = (assembly.formulas || []).find(
          (item) => item.id === line.formulaId,
        );
        return !!formula && formulaUsesName(formula.expression, field.name);
      }),
    )
    .map((block) => block.localName || block.name);
