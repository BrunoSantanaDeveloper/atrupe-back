import {
  AssemblyRow,
  BlockRow,
  ProductRow,
  assemblyFields,
  assemblyFormulas,
  blockRules,
  mergedLines,
  productPricing,
} from './assembly-graph';
import { LineRow } from './composition-lines';
import { BASE_RULES, FINISHING_RULES } from './sale-rules';

/**
 * A leitura da composição com o vínculo do processo (CP-21) e o cadastro do
 * produto convertido para a unidade comercial. A fumaça contra o Postgres
 * confere o resto (scratchpad da fase 3, smoke-assembly.js).
 */
const line = (id: string, extra: Partial<LineRow> = {}): LineRow => ({
  id,
  processId: 'p-1',
  blockId: null,
  sourceLineId: null,
  overridden: false,
  addedHere: false,
  name: id,
  kind: 'MATERIAL',
  mode: 'CHOOSE',
  formula: 'PER_AREA',
  perUnit: 1,
  lossPercent: 0,
  minimum: null,
  optional: false,
  optionalDefault: true,
  fieldName: null,
  formulaId: null,
  people: null,
  sheetMargin: null,
  sheetGap: null,
  chargeWholeSheets: null,
  timePrecision: null,
  selectedOptionId: `${id}-o1`,
  position: 0,
  createdAt: new Date(),
  options: [
    {
      id: `${id}-o1`,
      lineId: id,
      resourceId: 'material:a',
      configName: null,
      perUnit: null,
      lossPercent: null,
      minimum: null,
      position: 0,
    },
    {
      id: `${id}-o2`,
      lineId: id,
      resourceId: 'material:b',
      configName: null,
      perUnit: null,
      lossPercent: null,
      minimum: null,
      position: 1,
    },
  ],
  ...extra,
});

const process = (extra = {}) =>
  ({
    id: 'p-1',
    name: 'Impressão solvente',
    afterBase: 'INHERIT',
    setupMinutes: 10,
    taskType: 'Impressão',
    isActive: true,
    rules: { ...BASE_RULES },
    sector: {
      id: 's-1',
      name: 'Impressão',
      saleUnit: 'HOUR',
      hourCost: 4500,
      hourSale: 12000,
    },
    lines: [line('l-1'), line('l-2'), line('l-3')],
    fields: [
      {
        id: 'pf-1',
        name: 'Distância entre ilhoses',
        defaultValue: 0.5,
        allowsFraction: true,
      },
    ],
    formulas: [{ id: 'pfx-1', name: 'Bastão', expression: 'largura * 2' }],
    ...extra,
  }) as unknown as BlockRow['process'];

const block = (extra: Partial<BlockRow> = {}): BlockRow =>
  ({
    id: 'b-1',
    assemblyId: 'a-1',
    type: 'PROCESS',
    processId: 'p-1',
    partProductId: null,
    name: '',
    sectorId: null,
    setupMinutes: 0,
    taskType: '',
    rules: null,
    dependsOn: [],
    baseBlockId: null,
    localName: null,
    localTaskType: null,
    localRules: null,
    removedSourceLineIds: [],
    position: 0,
    createdAt: new Date(),
    sector: null,
    process: process(),
    lines: [],
    ...extra,
  }) as BlockRow;

const own = (id: string, extra: Partial<LineRow> = {}) =>
  line(id, { processId: null, blockId: 'b-1', ...extra });

describe('composição: o vínculo com o processo (CP-21)', () => {
  it('sem nada do produto, as linhas são as do processo, com o id delas', () => {
    expect(
      mergedLines(block()).map((item) => [item.id, item.sourceLineId]),
    ).toEqual([
      ['l-1', 'l-1'],
      ['l-2', 'l-2'],
      ['l-3', 'l-3'],
    ]);
  });

  it('a escolha do produto vale enquanto a opção existir no processo', () => {
    const rows = [
      own('r-1', { sourceLineId: 'l-1', selectedOptionId: 'l-1-o2' }),
      own('r-2', { sourceLineId: 'l-2', selectedOptionId: 'sumiu' }),
    ];
    const lines = mergedLines(block({ lines: rows }));
    expect(lines[0]).toMatchObject({
      id: 'l-1',
      selectedOptionId: 'l-1-o2',
      overridden: false,
    });
    expect(lines[1]).toMatchObject({ id: 'l-2', selectedOptionId: 'l-2-o1' });
  });

  it('a linha ajustada é a do produto, no lugar da do processo', () => {
    const rows = [
      own('r-1', {
        sourceLineId: 'l-2',
        overridden: true,
        perUnit: 3,
        options: [],
      }),
    ];
    const lines = mergedLines(block({ lines: rows }));
    expect(lines[1]).toMatchObject({ id: 'l-2', overridden: true, perUnit: 3 });
    expect(lines[1].options).toEqual([]);
  });

  it('a tirada sai; a acrescentada vem depois; a ajustada que o processo tirou fica', () => {
    const rows = [
      own('r-9', { sourceLineId: null, position: 2 }),
      own('r-8', { sourceLineId: 'apagada', overridden: true, position: 1 }),
      own('r-7', { sourceLineId: 'apagada-2', overridden: false, position: 0 }),
    ];
    const lines = mergedLines(
      block({ lines: rows, removedSourceLineIds: ['l-2'] }),
    );
    expect(lines.map((item) => [item.id, item.addedHere])).toEqual([
      ['l-1', false],
      ['l-3', false],
      ['r-9', true],
      ['r-8', true],
    ]);
  });

  it('a etapa própria é só dela', () => {
    const rows = [own('r-1'), own('r-2')];
    expect(
      mergedLines(block({ type: 'OWN', process: null, lines: rows })).map(
        (item) => item.id,
      ),
    ).toEqual(['r-1', 'r-2']);
  });

  it('as regras: as do processo pela posição, e o ajuste local', () => {
    expect(blockRules(block()).original).toEqual(BASE_RULES);
    expect(blockRules(block({ dependsOn: ['b-0'] })).original).toMatchObject({
      dimension: 'SAME_AS_PARENT',
      quantityMode: 'HIDDEN_ONE',
    });
    expect(
      blockRules(
        block({
          dependsOn: ['b-0'],
          process: process({ afterBase: 'OWN' }),
        }),
      ).original,
    ).toEqual(BASE_RULES);
    expect(
      blockRules(block({ localRules: { ...FINISHING_RULES } })).local,
    ).toEqual(FINISHING_RULES);
    expect(
      blockRules(block({ type: 'OWN', process: null, rules: FINISHING_RULES }))
        .original,
    ).toEqual(FINISHING_RULES);
  });

  it('os campos do processo chegam pelo nome; os do produto valem primeiro', () => {
    const assembly = {
      blocks: [block()],
      fields: [],
      formulas: [],
    } as unknown as AssemblyRow;
    expect(assemblyFields(assembly)).toEqual([
      expect.objectContaining({ id: 'pf-1', virtual: true, fromProcess: true }),
    ]);

    const withOwn = {
      ...assembly,
      fields: [
        {
          id: 'f-1',
          name: 'DISTANCIA ENTRE ILHOSES',
          defaultValue: 0.3,
          allowsFraction: true,
        },
      ],
    } as unknown as AssemblyRow;
    expect(assemblyFields(withOwn)).toEqual([
      expect.objectContaining({
        id: 'f-1',
        defaultValue: 0.3,
        virtual: false,
        fromProcess: true,
      }),
    ]);
  });

  it('as fórmulas do processo vêm marcadas com ele', () => {
    const assembly = {
      blocks: [block(), block({ id: 'b-2' })],
      fields: [],
      formulas: [{ id: 'fx-1', name: 'Travessas', expression: 'largura' }],
    } as unknown as AssemblyRow;
    expect(assemblyFormulas(assembly)).toEqual([
      { id: 'fx-1', name: 'Travessas', expression: 'largura' },
      {
        id: 'pfx-1',
        name: 'Bastão',
        expression: 'largura * 2',
        processId: 'p-1',
      },
    ]);
  });
});

describe('composição: o cadastro do produto na unidade comercial', () => {
  const product = (item: Record<string, unknown> | null) =>
    ({ items: item ? [item] : [] }) as unknown as ProductRow;

  it('o preço por mm² vira preço por m²; a medida padrão sai do item', () => {
    expect(
      productPricing(
        product({
          unitKind: 'AREA',
          unitCost: 0.0045,
          width: 900,
          height: 1200,
        }),
      ),
    ).toEqual({
      unitKind: 'AREA',
      unitPrice: 4500,
      measure: { quantity: 1, width: 900, height: 1200 },
      unitAmount: 1,
    });
  });

  it('metro e quilo: o preço e quanto cada peça tem', () => {
    expect(
      productPricing(
        product({ unitKind: 'LENGTH', unitCost: 2.5, length: 2000 }),
      ),
    ).toMatchObject({ unitPrice: 2500, unitAmount: 2 });
    expect(
      productPricing(
        product({ unitKind: 'WEIGHT', unitCost: 0.001, weight: 500_000 }),
      ),
    ).toMatchObject({ unitPrice: 1000, unitAmount: 0.5 });
  });

  it('sem item ou sem preço: unidade, preço vazio, 1 × 1 m', () => {
    expect(productPricing(product(null))).toEqual({
      unitKind: 'UNITY',
      unitPrice: null,
      measure: { quantity: 1, width: 1000, height: 1000 },
      unitAmount: 1,
    });
  });
});
