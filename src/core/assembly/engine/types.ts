/**
 * Os tipos do motor da composição (contrato da API, módulo 1, parte A). O
 * motor trabalha em metros (medidas, folha) e em centavos (custo e venda);
 * a API recebe e devolve milímetros e converte na borda. O perfil do material
 * fica em milímetros, como o cadastro guarda.
 *
 * São os mesmos tipos do mock do front (app-web, composicao/assembly.ts),
 * sem o que só a tela usa.
 */

export type ResourceKind = 'MACHINE' | 'MATERIAL' | 'LABOR' | 'OUTSOURCED';

/** As fórmulas do legado traduzidas para nomes (D3 §9.2), e as novas. */
export const FORMULA_KEYS = [
  'FIXED',
  'SELLER',
  'PER_AREA',
  'PER_UNIT',
  'PER_PERIMETER',
  'PER_WIDTH',
  'PER_HEIGHT',
  'PER_EXTRA',
  'PER_TIME',
  'PER_PERIMETER_DIV_EXTRA',
  'TIME_TIMES_EXTRA',
  'EQUAL_TIME',
  'PER_WIDTH_EXTRA',
  'PER_HEIGHT_EXTRA',
  'EXTRA_ONLY',
  'PER_AREA_DIV_EXTRA',
  'PER_PERIMETER_EXTRA',
  'DIV_EXTRA',
  'AREA_EXTRA',
  'PER_AREA_EXTRA',
  'SHEET_YIELD',
  'CUSTOM',
] as const;
export type FormulaKey = (typeof FORMULA_KEYS)[number];

export type DimensionRule =
  | 'NONE'
  | 'FREE_SIZE'
  | 'FREE_AREA'
  | 'FIXED_SIZE'
  | 'SAME_AS_PARENT';

export type QuantityMode = 'HIDDEN_ONE' | 'FREE' | 'AREA_RATIO';
export type ExtraFieldKind = 'NONE' | 'DECIMAL' | 'INTEGER';
export type LineMode = 'SINGLE' | 'CHOOSE' | 'LIST';

/** Regras de venda da etapa (MS-3 a MS-6). */
export type SaleRules = {
  quantityMode: QuantityMode;
  followsBase: boolean;
  dimension: DimensionRule;
  timeField: boolean;
  /** Tempo padrão da etapa, em minutos (IP-32) */
  timeFieldDefault: number;
  extraField: ExtraFieldKind;
  extraFieldName: string;
  extraFieldDefault: number;
  descriptionEditable: boolean;
};

export type UnitKind =
  | 'AREA'
  | 'LENGTH'
  | 'WEIGHT'
  | 'CAPACITY'
  | 'DISTANCE'
  | 'DURATION'
  | 'UNITY'
  // A folha (Papéis no LITE, 13/10/2026): vendida por folha, como a unidade
  | 'SHEET';

export type Measure = { quantity: number; width: number; height: number };

/** Uma opção da linha: o recurso, já com o custo e a venda resolvidos. */
export type EngineOption = {
  id: string;
  resourceId?: string;
  configName?: string;
  name: string;
  unit: string;
  /** Centavos por unidade do recurso; mão de obra, por minuto */
  unitCost: number;
  /** Venda do cadastro; sem ela, custo × markup de referência (IP-25) */
  unitSale?: number | null;
  /** Folha, em metros (AP-2) */
  sheet?: { width: number; height: number; wholeSheets?: boolean } | null;
  /** Perfil, em milímetros (MT-10.1) */
  profile?: { x: number; y: number; barLength?: number | null } | null;
  /** Quilos por unidade de venda */
  weight?: number | null;
  /** Consumo, perda e mínimo próprios da opção (IP-26) */
  perUnit?: number;
  lossPercent?: number;
  minimum?: number | null;
};

export type EngineLine = {
  id: string;
  name: string;
  kind: ResourceKind;
  mode: LineMode;
  options: EngineOption[];
  selectedId: string;
  perUnit: number;
  formula: FormulaKey;
  lossPercent: number;
  minimum: number | null;
  overridden?: boolean;
  sourceLineId?: string;
  addedHere?: boolean;
  optional?: boolean;
  optionalDefault?: boolean;
  fieldName?: string;
  formulaId?: string;
  people?: number;
  /** Aproveitamento de folha, em milímetros (AP-3, AP-4) */
  sheetMargin?: number;
  sheetGap?: number;
  chargeWholeSheets?: boolean;
};

export type EngineBlock = {
  id: string;
  processId: string | null;
  name: string;
  localName?: string;
  partProductId?: string;
  sector: string;
  dependsOn: string[];
  baseBlockId: string | null;
  setupMinutes: number;
  /** Custo e venda da hora do setor, em centavos: o preparo usa os dois */
  sectorHourCost: number;
  sectorHourSale: number;
  originalRules: SaleRules;
  localRules: SaleRules | null;
  lines: EngineLine[];
  /** Medida fixa que ignora as regras: a base simulada do processo (§9.1) */
  fixedMeasure?: Measure;
  /** O processo de origem foi inativado (PAD-7) */
  processInactive?: boolean;
};

export type QuoteField = {
  id: string;
  name: string;
  defaultValue: number;
  allowsFraction?: boolean;
};

export type ProductFormula = {
  id: string;
  name: string;
  expression: string;
  processId?: string;
};

export type PriceTier = { from: number; unitPrice: number };

export type EngineVariation = {
  id: string;
  name: string;
  unitPrice: number | null;
  /** Tabela própria da variação (FQ-4); sem ela, vale a do produto */
  priceTiers?: PriceTier[] | null;
};

export type EngineAssembly = {
  productId: string;
  name: string;
  unitKind: UnitKind;
  /** Centavos por unidade comercial */
  unitPrice: number | null;
  measure: Measure;
  unitAmount: number;
  priceTiers: PriceTier[];
  blocks: EngineBlock[];
  fields?: QuoteField[];
  formulas?: ProductFormula[];
  /** Produto inativado no cadastro: segue como parte, marcado (PAD-7) */
  inactive?: boolean;
};

export type SheetYield = {
  sheetName: string;
  firstFit: number;
  secondFit: number;
  perSheet: number;
  sheets: number;
  leftover: number;
  charged: number;
  marginMm: number;
  gapMm: number;
};

export type ComputedLine = EngineLine & {
  people?: number;
  sheetYield: SheetYield | null;
  extraValue: number | null;
  formulaName: string | null;
  selected: EngineOption | null;
  quantity: number | null;
  minimumApplied: boolean;
  effective: {
    perUnit: number;
    lossPercent: number;
    minimum: number | null;
    own: boolean;
  };
  cost: number | null;
  sale: number | null;
};

export type FlowStage = {
  id: string;
  name: string;
  sector: string;
  dependsOn: string[];
  processId: string | null;
  partProductId: string | null;
  partFlow: FlowStage[] | null;
};

export type ComputedBlock = Omit<EngineBlock, 'lines'> & {
  rules: SaleRules;
  measure: Measure;
  setupCost: number;
  setupSale: number;
  cost: number;
  sale: number;
  lines: ComputedLine[];
  part: { productId: string; name: string; stages: number } | null;
  partFlow: FlowStage[] | null;
  partLines: ComputedLine[];
  partSetupMinutes: number;
  processInactive: boolean;
  partInactive: boolean;
};

export type ResourceSummary = {
  id: string;
  name: string;
  kind: ResourceKind;
  unit: string;
  quantity: number;
  cost: number;
  sale: number;
  people?: number;
};

export type ComputedAssembly = Omit<
  EngineAssembly,
  'blocks' | 'fields' | 'formulas'
> & {
  area: number;
  blocks: ComputedBlock[];
  resourceSummary: ResourceSummary[];
  fields: (QuoteField & { usedBy: string[] })[];
  formulas: (ProductFormula & { usedBy: string[]; error: string | null })[];
  cost: number;
  suggestedPrice: number;
  saleAmount: number;
  priceForMeasure: number | null;
  suggestedUnitPrice: number;
  margin: number | null;
  activeVariation: EngineVariation | null;
  activeTier: PriceTier | null;
  effectiveTiers: PriceTier[];
  tiersFromVariation: boolean;
};

/** O que o motor pede de fora: partes, nomes e o markup de referência. */
export type EngineDeps = {
  /** Custo × markup quando o recurso não tem venda própria (IP-25, PR-1) */
  referenceMarkup: number;
  /** A composição do produto usado como parte (IP-9), ou nulo */
  partOf: (productId: string) => EngineAssembly | null;
  /** O nome do recurso no cadastro, para o resumo (IP-34) */
  resourceName?: (resourceId: string) => string | undefined;
};
