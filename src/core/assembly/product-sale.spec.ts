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

  it('sem composição ou em montagem, nulo (vende pelo cadastro, IP-14 revisto em 29/10/2026); inativo, não é vendável', async () => {
    assemblies.assemblyRow.mockResolvedValueOnce(null);
    expect(await service.saleForm('c-1', 'pr-1')).toBeNull();

    assemblies.assemblyRow.mockResolvedValueOnce(assembly('DRAFT'));
    expect(await service.saleForm('c-1', 'pr-1')).toBeNull();
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

  describe('a variação com papel conta as folhas (Papéis no LITE)', () => {
    const couche = {
      id: 'v-1',
      name: 'Couché',
      unitPrice: null,
      priceTiers: [],
      assemblies: [],
      paper: {
        id: 'mat-1',
        name: 'Couché 300 g',
        grammage: 300,
        sheetFormat: 'SRA3',
        sheetWidth: 320,
        sheetHeight: 450,
        usableWidth: 310,
        usableHeight: 440,
      },
    };

    beforeEach(() => {
      // O cartão: 90 × 50 mm no cadastro
      assemblies.product.mockResolvedValue(
        product({
          items: [{ unitKind: 'UNITY', unitCost: 0, width: 90, height: 50 }],
          variations: [couche],
        }),
      );
      assemblies.variationOf.mockReturnValue(couche);
    });

    it('o formulário traz as peças por folha na medida do cadastro', async () => {
      const form = (await service.saleForm('c-1', 'pr-1', 'v-1'))!;
      expect(form.sheetCount).toEqual({
        paperName: 'Couché 300 g',
        piecesPerSheet: 24,
        sheets: 1,
        warning: null,
      });
    });

    it('o relatório conta as folhas da quantidade vendida, sem custo', async () => {
      const report = await service.saleComposition('c-1', 'pr-1', {
        variationId: 'v-1',
        measure: { quantity: 1000, width: 0, height: 0 },
      });
      expect(report.sheetCount).toEqual({
        paperName: 'Couché 300 g',
        piecesPerSheet: 24,
        sheets: 42,
        warning: null,
      });
      expect(JSON.stringify(report.sheetCount)).not.toMatch(/cost|price/i);

      // A medida informada vale sobre a do cadastro; maior que a área útil,
      // não cabe
      const big = await service.saleComposition('c-1', 'pr-1', {
        variationId: 'v-1',
        measure: { quantity: 10, width: 500, height: 320 },
      });
      expect(big.sheetCount).toMatchObject({
        piecesPerSheet: 0,
        warning: 'A peça não cabe na área útil do papel',
      });
    });

    it('sem papel na variação, nada', async () => {
      assemblies.variationOf.mockReturnValue({ ...couche, paper: null });
      const report = await service.saleComposition('c-1', 'pr-1', {
        variationId: 'v-1',
      });
      expect(report.sheetCount).toBeNull();
    });
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

  it('o item só leva composição de produto aprovado e com lista preenchida', async () => {
    assemblies.assemblyRow.mockResolvedValueOnce(assembly('DRAFT'));
    await expect(
      service.itemComposition('c-1', 'pr-1', null, { quantity: 1 }, {}),
    ).rejects.toThrow('ainda não foi aprovada');
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
