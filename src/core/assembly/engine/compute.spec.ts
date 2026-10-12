import { readFileSync } from 'fs';
import { join } from 'path';
import {
  computeAssembly,
  fitCount,
  lineQuantity,
  orderBlocks,
  sheetYieldOf,
  tierFor,
} from './compute';
import { ComputedLine, EngineAssembly, EngineDeps } from './types';

/**
 * O motor contra o mock do front (DoD da Fase 3: "casos de teste do motor
 * extraídos do mock rodando no servidor com a mesma ordem de
 * arredondamento"). O gabarito saiu do próprio mock (app-web,
 * actions/product-assembly.ts › compute), rodado em Node sobre os produtos de
 * exemplo em quatro medidas: Banner ITP1 (as contas do legado), cartão AP-1
 * (aproveitamento de folha), quadro de metalon (fórmula do produto), placa com
 * quadro (parte), painel e fachada de ACM.
 */
type Fixture = {
  referenceMarkup: number;
  assemblies: { [productId: string]: EngineAssembly };
  resources: { [id: string]: { name: string } };
  cases: {
    productId: string;
    measure: { quantity: number; width: number; height: number };
    expected: unknown;
  }[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'mock-golden.json'), 'utf8'),
);

const deps: EngineDeps = {
  referenceMarkup: fixture.referenceMarkup,
  partOf: (productId) => fixture.assemblies[productId] ?? null,
  resourceName: (id) => fixture.resources[id]?.name,
};

const lineView = (line: ComputedLine) => ({
  id: line.id,
  selectedId: line.selected ? line.selected.id : null,
  quantity: line.quantity,
  minimumApplied: line.minimumApplied,
  cost: line.cost,
  sale: line.sale,
  extraValue: line.extraValue,
  sheetYield: line.sheetYield,
});

describe('motor da composição: os casos do mock', () => {
  it('o gabarito tem os seis produtos nas quatro medidas', () => {
    expect(fixture.cases).toHaveLength(24);
  });

  it.each(
    fixture.cases.map((item) => [
      `${item.productId} ${item.measure.quantity} × ${item.measure.width} × ${item.measure.height}`,
      item,
    ]),
  )('%s', (_label, item: Fixture['cases'][number]) => {
    const result = computeAssembly(
      { ...fixture.assemblies[item.productId], measure: item.measure },
      deps,
    );

    const actual = {
      area: result.area,
      cost: result.cost,
      suggestedPrice: result.suggestedPrice,
      saleAmount: result.saleAmount,
      priceForMeasure: result.priceForMeasure,
      suggestedUnitPrice: result.suggestedUnitPrice,
      margin: result.margin,
      blocks: result.blocks.map((block) => ({
        id: block.id,
        name: block.name,
        measure: block.measure,
        setupCost: block.setupCost,
        setupSale: block.setupSale,
        cost: block.cost,
        sale: block.sale,
        part: block.part,
        partSetupMinutes: block.partSetupMinutes,
        lines: block.lines.map(lineView),
        partLines: block.partLines.map(lineView),
      })),
      resourceSummary: result.resourceSummary,
      fields: result.fields.map((field) => ({
        name: field.name,
        defaultValue: field.defaultValue,
        usedBy: field.usedBy,
      })),
      formulas: result.formulas.map((formula) => ({
        id: formula.id,
        usedBy: formula.usedBy,
        error: formula.error,
      })),
    };

    // JSON: o gabarito não tem `undefined`
    expect(JSON.parse(JSON.stringify(actual))).toEqual(item.expected);
  });
});

describe('motor da composição: peças', () => {
  const measure = { quantity: 2, width: 1.5, height: 0.8 };

  it.each([
    ['FIXED', 3, 3],
    ['PER_AREA', 2, 2 * 1.2 * 2],
    ['PER_UNIT', 2, 4],
    ['PER_PERIMETER', 1, 4.6 * 2],
    ['PER_WIDTH', 1, 3],
    ['PER_HEIGHT', 1, 1.6],
    ['PER_EXTRA', 1, 10],
    ['PER_PERIMETER_DIV_EXTRA', 1, Math.ceil(4.6 / 5) * 2],
    ['EXTRA_ONLY', 2, 10],
    ['DIV_EXTRA', 10, 2],
    ['AREA_EXTRA', 1, 1.2 * 5],
  ] as const)('%s', (formula, perUnit, expected) => {
    expect(lineQuantity({ formula, perUnit }, measure, 5)).toBeCloseTo(
      expected,
      10,
    );
  });

  it('o vendedor informa: sem conta', () => {
    expect(lineQuantity({ formula: 'SELLER', perUnit: 1 }, measure, 0)).toBe(
      null,
    );
  });

  it('dividir por campo zerado não dá conta', () => {
    expect(
      lineQuantity({ formula: 'PER_AREA_DIV_EXTRA', perUnit: 1 }, measure, 0),
    ).toBeNull();
  });

  it('o tempo informado substitui o consumo', () => {
    expect(
      lineQuantity({ formula: 'PER_TIME', perUnit: 30 }, measure, 0, 45),
    ).toBe(90);
    expect(
      lineQuantity({ formula: 'PER_TIME', perUnit: 30 }, measure, 0, null),
    ).toBe(60);
  });

  it('a folha testa as duas posições da peça (AP-1)', () => {
    // A3 (0,297 × 0,42) com cartões de 0,09 × 0,05
    expect(fitCount(0.297, 0.42, 0.09, 0.05)).toBe(3 * 8);
    expect(fitCount(0.297, 0.42, 0.05, 0.09)).toBe(5 * 4);

    const yieldOf = sheetYieldOf(
      {
        id: 'a3',
        name: 'Couchê A3',
        unit: 'un',
        unitCost: 50,
        sheet: { width: 0.297, height: 0.42 },
      },
      0.09,
      0.05,
      500,
    );
    expect(yieldOf).toMatchObject({
      perSheet: 24,
      sheets: 21,
      leftover: 4,
      charged: 21,
    });
  });

  it('só a fração aproveitada, quando a linha não cobra a folha inteira (AP-4)', () => {
    const yieldOf = sheetYieldOf(
      {
        id: 'a3',
        name: 'A3',
        unit: 'un',
        unitCost: 50,
        sheet: { width: 0.297, height: 0.42 },
      },
      0.09,
      0.05,
      500,
      { wholeSheets: false },
    );
    expect(yieldOf?.charged).toBe(20.833);
  });

  it('a faixa vale para o total: a maior que a quantidade alcança (FQ-2)', () => {
    const tiers = [
      { from: 1, unitPrice: 35 },
      { from: 101, unitPrice: 28 },
      { from: 501, unitPrice: 20 },
    ];
    expect(tierFor(tiers, 100)?.unitPrice).toBe(35);
    expect(tierFor(tiers, 150)?.unitPrice).toBe(28);
    expect(tierFor(tiers, 501)?.unitPrice).toBe(20);
    expect(tierFor([], 10)).toBeNull();
  });

  it('as etapas vêm depois das que elas dependem, e um laço não trava', () => {
    expect(
      orderBlocks([
        { id: 'c', dependsOn: ['b'] },
        { id: 'a', dependsOn: [] },
        { id: 'b', dependsOn: ['a'] },
      ]).map((block) => block.id),
    ).toEqual(['a', 'b', 'c']);
    expect(
      orderBlocks([
        { id: 'x', dependsOn: ['y'] },
        { id: 'y', dependsOn: ['x'] },
      ]).map((block) => block.id),
    ).toEqual(['x', 'y']);
  });

  it('parte dentro de parte para no terceiro nível', () => {
    const loop: EngineAssembly = {
      productId: 'loop',
      name: 'Laço',
      unitKind: 'UNITY',
      unitPrice: null,
      measure: { quantity: 1, width: 1, height: 1 },
      unitAmount: 1,
      priceTiers: [],
      blocks: [
        {
          id: 'b',
          processId: null,
          name: 'Ela mesma',
          partProductId: 'loop',
          sector: 'Produção',
          dependsOn: [],
          baseBlockId: null,
          setupMinutes: 10,
          sectorHourCost: 600,
          sectorHourSale: 1200,
          originalRules: {
            quantityMode: 'FREE',
            followsBase: true,
            dimension: 'FREE_SIZE',
            timeField: false,
            timeFieldDefault: 0,
            extraField: 'NONE',
            extraFieldName: '',
            extraFieldDefault: 0,
            descriptionEditable: true,
          },
          localRules: null,
          lines: [],
        },
      ],
    };

    const result = computeAssembly(loop, {
      referenceMarkup: 1.68,
      partOf: () => loop,
    });

    // Quatro níveis de preparo: o produto e três partes
    expect(result.cost).toBe(400);
    expect(result.blocks[0].partSetupMinutes).toBe(30);
  });
});
