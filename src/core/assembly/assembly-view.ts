import {
  ComputedBlock,
  ComputedLine,
  EngineOption,
  Measure,
  ResourceSummary,
} from './engine/types';

/**
 * A saída do motor no formato do contrato: medidas em mm (o motor calcula em
 * metros), a folha da opção em mm e a venda do recurso já resolvida (sem
 * preço próprio, custo × markup de referência, IP-25).
 */

/** Os campos de valor da composição: sem `values:values:view`, saem. */
export const ASSEMBLY_MONEY_FIELDS = new Set([
  'unitCost',
  'unitSale',
  'cost',
  'sale',
  'setupCost',
  'setupSale',
  'suggestedPrice',
  'suggestedUnitPrice',
  'margin',
  'priceForMeasure',
]);

const mm = (meters: number) => Math.round(meters * 1_000_000) / 1000;

export const toMeters = (millimeters: number) => millimeters / 1000;

export const measureMm = (measure: Measure) => ({
  quantity: measure.quantity,
  width: mm(measure.width),
  height: mm(measure.height),
});

export const optionView = (option: EngineOption, referenceMarkup: number) => ({
  id: option.id,
  resourceId: option.resourceId ?? option.id,
  configName: option.configName ?? null,
  name: option.name,
  unit: option.unit,
  unitCost: option.unitCost,
  unitSale: option.unitSale ?? option.unitCost * referenceMarkup,
  perUnit: option.perUnit ?? null,
  lossPercent: option.lossPercent ?? null,
  minimum: option.minimum ?? null,
  ...(option.sheet
    ? {
        sheet: {
          width: mm(option.sheet.width),
          height: mm(option.sheet.height),
          wholeSheets: option.sheet.wholeSheets ?? true,
        },
      }
    : {}),
  ...(option.profile ? { profile: option.profile } : {}),
  ...(option.weight ? { weight: option.weight } : {}),
});

export const lineView = (
  line: ComputedLine,
  referenceMarkup: number,
  formulaNames: Map<string, string>,
) => ({
  id: line.id,
  name: line.name,
  kind: line.kind,
  mode: line.mode,
  selectedId: line.selectedId || null,
  formula: line.formula,
  perUnit: line.perUnit,
  lossPercent: line.lossPercent,
  minimum: line.minimum,
  optional: !!line.optional,
  optionalDefault: line.optionalDefault ?? true,
  fieldName: line.fieldName ?? null,
  formulaId: line.formulaId ?? null,
  formulaName:
    line.formulaName ??
    (line.formulaId ? (formulaNames.get(line.formulaId) ?? null) : null),
  people: line.people ?? null,
  sheetMargin: line.sheetMargin ?? null,
  sheetGap: line.sheetGap ?? null,
  timePrecision: line.timePrecision ?? null,
  chargeWholeSheets: line.chargeWholeSheets ?? null,
  overridden: !!line.overridden,
  addedHere: !!line.addedHere,
  options: line.options.map((option) => optionView(option, referenceMarkup)),
  selected: line.selected ? optionView(line.selected, referenceMarkup) : null,
  effective: line.effective,
  quantity: line.quantity,
  minimumApplied: line.minimumApplied,
  sheetYield: line.sheetYield,
  extraValue: line.extraValue,
  cost: line.cost,
  sale: line.sale,
});

export const blockLinesView = (
  block: ComputedBlock,
  referenceMarkup: number,
  formulaNames: Map<string, string>,
) => block.lines.map((line) => lineView(line, referenceMarkup, formulaNames));

export const summaryView = (entry: ResourceSummary) => ({
  resourceId: entry.id,
  name: entry.name,
  kind: entry.kind,
  unit: entry.unit,
  quantity: entry.quantity,
  cost: entry.cost,
  sale: entry.sale,
  people: entry.people ?? null,
});
