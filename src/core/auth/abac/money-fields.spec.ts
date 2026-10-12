import { Prisma } from '@prisma/client';
import {
  ASSET_MONEY_FIELDS,
  MONEY_COLUMNS,
  PRODUCT_MONEY_FIELDS,
  QUOTATION_MONEY_FIELDS,
} from './money-fields';

/**
 * As listas do @MoneyFields contra o schema: toda coluna numérica dos models
 * que as rotas antigas devolvem está classificada, como dinheiro
 * (MONEY_COLUMNS) ou como medida, contagem ou prazo (aqui). Coluna nova sem
 * classificar quebra o teste, em vez de sair para quem não tem
 * `values:values:view`.
 */
const NOT_MONEY: Record<keyof typeof MONEY_COLUMNS, string[]> = {
  ProductItem: [
    'distance',
    'duration',
    'height',
    'length',
    'volume',
    'weight',
    'width',
  ],
  Asset: ['usefulLife'],
  Quotation: ['quotationNumber'],
  QuotationProduct: ['quantity'],
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
      QUOTATION_MONEY_FIELDS,
    ]) {
      expect(list).not.toContain('total');
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('as listas de produto e de patrimônio são as colunas de dinheiro deles', () => {
    expect(PRODUCT_MONEY_FIELDS).toEqual(['unitCost', 'salePrice']);
    expect(ASSET_MONEY_FIELDS).toEqual([...MONEY_COLUMNS.Asset]);
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
