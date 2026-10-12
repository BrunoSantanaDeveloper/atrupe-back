import { NotFoundException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { HAS_ANY_PERMISSION_KEY } from '../auth/abac/has-any-permission.decorator';
import { HAS_PERMISSION_KEY } from '../auth/abac/has-permission.decorator';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';
import { ProductSaleController } from './product-sale.controller';
import { ProductSaleService } from './product-sale.service';
import { BASE_RULES } from './sale-rules';

/**
 * O produto na venda: a vista do vendedor pede o orçamento e a composição
 * do plano, nunca a permissão da composição, e não devolve custo.
 */
const option = (id: string, resourceId: string) => ({
  id,
  lineId: 'l',
  resourceId,
  configName: null,
  perUnit: null,
  lossPercent: null,
  minimum: null,
  position: 0,
});

const line = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  processId: null,
  blockId: 'b-1',
  sourceLineId: null,
  overridden: false,
  addedHere: false,
  name: id,
  kind: 'MATERIAL',
  mode: 'SINGLE',
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
  selectedOptionId: null,
  position: 0,
  createdAt: new Date(),
  options: [option(`${id}-o1`, 'material:a')],
  ...extra,
});

const assembly = (status = 'RELEASED') => ({
  id: 'a-1',
  status,
  blocks: [
    {
      id: 'b-1',
      type: 'OWN',
      processId: null,
      partProductId: null,
      name: 'Impressão',
      sectorId: 's-1',
      setupMinutes: 0,
      taskType: 'Impressão',
      rules: { ...BASE_RULES },
      dependsOn: [],
      baseBlockId: null,
      localName: null,
      localTaskType: null,
      localRules: null,
      removedSourceLineIds: [],
      position: 0,
      sector: {
        id: 's-1',
        name: 'Impressão',
        saleUnit: 'HOUR',
        hourCost: 0,
        hourSale: 0,
      },
      process: null,
      lines: [
        line('Material', {
          mode: 'CHOOSE',
          selectedOptionId: 'Material-o2',
          options: [
            option('Material-o1', 'material:a'),
            option('Material-o2', 'material:b'),
          ],
        }),
        line('Cordão', { optional: true, optionalDefault: false }),
        line('Vazia', { options: [] }),
      ],
    },
  ],
  fields: [],
  formulas: [],
});

const product = (extra = {}) => ({
  id: 'pr-1',
  name: 'Banner',
  isActive: true,
  items: [{ unitKind: 'AREA', unitCost: 0.0045, width: 900, height: 1200 }],
  priceTiers: [],
  variations: [],
  ...extra,
});

const resources = new Map(
  ['material:a', 'material:b'].map((id) => [
    id,
    {
      resourceId: id,
      kind: 'MATERIAL',
      name: id === 'material:a' ? 'Lona' : 'Fosca',
      unit: 'm²',
      unitCost: 100,
      unitSale: 200,
    },
  ]),
);

describe('ProductSaleController', () => {
  it('a classe pede a composição do plano; o vendedor lê com o orçamento', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ProductSaleController),
    ).toContain(FeatureGuard);
    expect(
      Reflect.getMetadata(REQUIRED_FEATURE_KEY, ProductSaleController),
    ).toBe('product_composition');
    expect(
      Reflect.getMetadata(
        HAS_ANY_PERMISSION_KEY,
        ProductSaleController.prototype.saleForm,
      ),
    ).toEqual([
      { action: 'view', resource: 'sale:quotation' },
      { action: 'edit', resource: 'sale:quotation' },
    ]);
    const report = ProductSaleController.prototype.saleComposition;
    expect(Reflect.getMetadata(HAS_PERMISSION_KEY, report)).toEqual({
      action: 'view',
      resource: 'sale:quotation',
    });
    expect(Reflect.getMetadata(METHOD_METADATA, report)).toBe(
      RequestMethod.POST,
    );
  });
});

describe('ProductSaleService', () => {
  let assemblies: Record<string, jest.Mock>;
  let service: ProductSaleService;

  beforeEach(() => {
    assemblies = {
      product: jest.fn().mockResolvedValue(product()),
      variationOf: jest.fn().mockReturnValue(undefined),
      assemblyRow: jest.fn().mockResolvedValue(assembly()),
      loadGraph: jest.fn().mockResolvedValue({ parts: new Map(), resources }),
    };
    service = new ProductSaleService(
      {
        product: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ technicalDescription: 'Lona' }),
        },
      } as any,
      assemblies as any,
      { referenceMarkupOf: jest.fn().mockResolvedValue(1) } as any,
    );
  });

  it('sem composição, nulo; em edição ou inativo, não é vendável', async () => {
    assemblies.assemblyRow.mockResolvedValueOnce(null);
    expect(await service.saleForm('c-1', 'pr-1')).toBeNull();

    assemblies.assemblyRow.mockResolvedValueOnce(assembly('DRAFT'));
    await expect(service.saleForm('c-1', 'pr-1')).rejects.toThrow(
      'Este produto não está liberado para venda',
    );
    assemblies.product.mockResolvedValueOnce(product({ isActive: false }));
    await expect(service.saleForm('c-1', 'pr-1')).rejects.toThrow(
      'Este produto não está liberado para venda',
    );
  });

  it('o formulário traz a escolha e a opcional; a linha vazia não sai', async () => {
    const form = (await service.saleForm('c-1', 'pr-1'))!;
    expect(form.choices).toEqual([
      expect.objectContaining({
        lineId: 'Material',
        defaultId: 'Material-o2',
        options: [
          { id: 'Material-o1', name: 'Lona' },
          { id: 'Material-o2', name: 'Fosca' },
        ],
      }),
    ]);
    expect(form.optionals).toEqual([
      expect.objectContaining({ lineId: 'Cordão', defaultIncluded: false }),
    ]);
    expect(JSON.stringify(form)).not.toContain('Vazia');
    expect(JSON.stringify(form)).not.toMatch(/"(cost|unitCost|unitSale)"/);
  });

  it('o relatório tira a opcional desmarcada e a linha vazia, sem custo', async () => {
    const report = await service.saleComposition('c-1', 'pr-1', {
      optionals: [{ blockId: 'b-1', lineId: 'Cordão', included: false }],
    });
    expect(report.blocks[0].lines.map((item) => item.name)).toEqual([
      'Material',
    ]);
    expect(report.blocks[0].lines[0].resource).toBe('Fosca');
    expect(JSON.stringify(report)).not.toMatch(/"(cost|unitCost|unitSale)"/);
  });

  it('as escolhas precisam ser deste produto', async () => {
    await expect(
      service.saleComposition('c-1', 'pr-1', {
        choices: [
          { blockId: 'b-9', lineId: 'Material', optionId: 'Material-o1' },
        ],
      }),
    ).rejects.toThrow(new NotFoundException('Etapa não encontrada'));
    await expect(
      service.saleComposition('c-1', 'pr-1', {
        choices: [{ blockId: 'b-1', lineId: 'Material', optionId: 'x' }],
      }),
    ).rejects.toThrow(new NotFoundException('Opção não encontrada'));
  });

  it('vendido por unidade: a quantidade informada na medida padrão (AP-5)', async () => {
    const report = await service.saleComposition('c-1', 'pr-1', {
      measure: { quantity: 3, width: 0, height: 0 },
    });
    expect(report.measure).toEqual({ quantity: 3, width: 900, height: 1200 });
  });

  it('o item do orçamento guarda as escolhas, o resumo e o retrato com custo (ORC-10)', async () => {
    const { composition, snapshot } = await service.itemComposition(
      'c-1',
      'pr-1',
      null,
      { quantity: 2 },
      {
        choices: [
          { blockId: 'b-1', lineId: 'Material', optionId: 'Material-o1' },
        ],
        optionals: [{ blockId: 'b-1', lineId: 'Cordão', included: true }],
        times: [{ blockId: 'b-1', minutes: 90 }],
      },
    );
    expect(composition.summary).toEqual([
      'Tempo · Impressão: 1h30',
      'Lona',
      'Cordão',
    ]);
    // A medida que faltou vem do padrão do produto (900 × 1200 mm)
    expect(snapshot.measure).toEqual({ quantity: 2, width: 900, height: 1200 });
    const stage = snapshot.stages[0];
    expect(stage.lines.map((line) => line.name)).toEqual([
      'Material',
      'Cordão',
    ]);
    // 2 × 0,9 × 1,2 m² a R$ 1,00 o m²
    expect(stage.lines[0]).toMatchObject({
      resource: 'Lona',
      quantity: 2.16,
      unitCost: 100,
      cost: 216,
      actualQuantity: null,
    });
    expect(snapshot.cost).toBe(stage.cost);
  });

  it('o item só leva composição de produto liberado e com lista preenchida', async () => {
    assemblies.assemblyRow.mockResolvedValueOnce(assembly('DRAFT'));
    await expect(
      service.itemComposition('c-1', 'pr-1', null, { quantity: 1 }, {}),
    ).rejects.toThrow('Este produto não está liberado para venda');
    await expect(
      service.itemComposition(
        'c-1',
        'pr-1',
        null,
        { quantity: 1 },
        {
          lists: [
            {
              blockId: 'b-1',
              lineId: 'Material',
              optionId: 'Material-o1',
              quantity: 0,
            },
          ],
        },
      ),
    ).rejects.toThrow('Informe a quantidade de cada item da lista');
  });
});
