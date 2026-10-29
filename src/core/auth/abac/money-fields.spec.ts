import { Prisma } from '@prisma/client';
import {
  ASSET_MONEY_FIELDS,
  EMPLOYEE_MONEY_FIELDS,
  MONEY_COLUMNS,
  PRODUCT_MONEY_FIELDS,
  QUOTATION_MONEY_FIELDS,
} from './money-fields';
import { omitMoneyFields } from './values-visibility.interceptor';

/**
 * As listas do @MoneyFields contra o schema: toda coluna numérica dos models
 * que as rotas antigas devolvem está classificada, como dinheiro
 * (MONEY_COLUMNS) ou como medida, contagem ou prazo (aqui). Coluna nova sem
 * classificar quebra o teste, em vez de sair para quem não tem
 * `values:values:view`.
 */
const NOT_MONEY: Record<keyof typeof MONEY_COLUMNS, string[]> = {
  ProductVariation: ['position'],
  ProductItem: [
    'distance',
    'duration',
    'height',
    'length',
    'volume',
    'weight',
    'width',
  ],
  Asset: [
    'usefulLife',
    'usefulLifeMonths',
    'residualPercent',
    'monthlyProductivity',
  ],
  Quotation: ['quotationNumber'],
  QuotationProduct: ['quantity'],
  QuotationItemLine: [],
  QuotationProductItem: [
    'quantity',
    'originalQuantity',
    'distance',
    'duration',
    'height',
    'length',
    'volume',
    'weight',
    'width',
  ],
  QuotationPayment: [
    'installmentQty',
    'maxInstallmentQty',
    'minInstallmentQty',
  ],
  Commission: [],
  QuotationInstallment: [],
  DeliveryInfo: ['daysAfterApproval'],
  Employee: [],
};

const NUMERIC = ['Float', 'Decimal', 'Int', 'BigInt'];

const numericColumns = (name: string) =>
  Prisma.dmmf.datamodel.models
    .find((model) => model.name === name)
    ?.fields.filter(
      (field) => field.kind === 'scalar' && NUMERIC.includes(field.type),
    )
    .map((field) => field.name);

describe('campos de dinheiro das rotas antigas', () => {
  const models = Object.keys(MONEY_COLUMNS) as (keyof typeof MONEY_COLUMNS)[];

  it.each(models)('%s: toda coluna numérica está classificada', (model) => {
    const columns = numericColumns(model);
    expect(columns).toBeDefined();

    const classified = [...MONEY_COLUMNS[model], ...NOT_MONEY[model]];
    expect([...classified].sort()).toEqual([...columns].sort());
  });

  it('nenhuma lista tem `total`: nas listagens é a contagem de registros', () => {
    for (const list of [
      PRODUCT_MONEY_FIELDS,
      ASSET_MONEY_FIELDS,
      EMPLOYEE_MONEY_FIELDS,
      QUOTATION_MONEY_FIELDS,
    ]) {
      expect(list).not.toContain('total');
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('as listas de produto e de patrimônio cobrem as colunas de dinheiro deles', () => {
    // A lista de produtos traz o preço das variações (28/10/2026)
    expect(PRODUCT_MONEY_FIELDS).toEqual([
      'unitCost',
      'salePrice',
      'unitPrice',
    ]);
    const list = {
      data: [
        {
          name: 'Camiseta',
          items: [{ unitCost: 900, salePrice: 2000, width: 1 }],
          variations: [{ id: 'v-1', name: 'P', unitPrice: 2500 }],
        },
      ],
    };
    expect(omitMoneyFields(list, new Set(PRODUCT_MONEY_FIELDS))).toEqual({
      data: [
        {
          name: 'Camiseta',
          items: [{ width: 1 }],
          variations: [{ id: 'v-1', name: 'P' }],
        },
      ],
    });
    // O patrimônio leva também o que as respostas calculam (módulo 4)
    expect(ASSET_MONEY_FIELDS).toEqual(
      expect.arrayContaining([
        ...MONEY_COLUMNS.Asset,
        'monthlyDepreciation',
        'depreciatedValue',
        'remainingValue',
        'unitCost',
        'monthlyCost',
        'averageCost',
      ]),
    );
  });

  it('a lista do orçamento cobre as colunas e os nomes que as respostas calculam', () => {
    expect(QUOTATION_MONEY_FIELDS).toEqual(
      expect.arrayContaining([
        'totalValue',
        'finalValue',
        'discount',
        'discountTotal',
        'downPayment',
        'additionalFee',
        'value',
        'cost',
        'totalCommission',
        'maxDiscount',
        'unitValue',
        'originalValue',
        'amount',
        'freightPrice',
        'finalTotal',
      ]),
    );
  });
});
