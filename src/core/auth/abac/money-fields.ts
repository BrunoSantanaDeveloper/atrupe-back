/**
 * Os campos de dinheiro das rotas antigas, para o @MoneyFields.
 *
 * MONEY_COLUMNS são as colunas de dinheiro de cada model que essas rotas
 * devolvem. O teste confere contra o schema: coluna numérica nova num desses
 * models precisa ser classificada, senão o preço novo sai para quem não tem
 * `values:values:view`.
 */
export const MONEY_COLUMNS = {
  ProductItem: ['unitCost', 'salePrice'],
  // O preço de cada variação, que a lista de produtos traz junto
  ProductVariation: ['unitPrice'],
  Asset: [
    'purchaseValue',
    'residualValue',
    'fixedMonthlyCost',
    'variableQualityMonthlyCost',
    'variableTotalMonthlyCost',
    'acquisitionValue',
    'saleValue',
    'saleResult',
  ],
  // holdAmount: o valor exigido da venda pendente (PA, 12/11/2026)
  Quotation: ['totalValue', 'holdAmount'],
  QuotationProduct: [
    'totalValue',
    'discount',
    'finalValue',
    'addition',
    'linesTotal',
    // O preço por unidade do material de venda direta (ORG-1)
    'unitPrice',
  ],
  // A linha acrescentada no item (ORC-5); o custo nem é lido pelo detalhe
  QuotationItemLine: ['price', 'cost'],
  QuotationProductItem: ['totalValue', 'salePrice', 'unitCost'],
  QuotationPayment: [
    'totalValue',
    'finalValue',
    'downPayment',
    'downPaymentAdditionalFee',
    'mainAdditionalFee',
    'discountTotal',
    'discountValue',
  ],
  Commission: ['commissionValue', 'totalCommission'],
  QuotationInstallment: ['value', 'additionalFee'],
  DeliveryInfo: ['cost', 'value'],
  // O salário do cadastro e o salário base (D33)
  Employee: ['sallary', 'baseSalary'],
} as const;

type MoneyModel = keyof typeof MONEY_COLUMNS;

const columnsOf = (...models: MoneyModel[]): string[] => [
  ...new Set(models.flatMap((model) => [...MONEY_COLUMNS[model]])),
];

/** Colaborador: o salário só para quem vê valores (contrato, PATCH /employee) */
export const EMPLOYEE_MONEY_FIELDS = columnsOf('Employee');

/** Produto: custo e preço do produto e de cada item dele */
export const PRODUCT_MONEY_FIELDS = columnsOf(
  'ProductItem',
  'ProductVariation',
);

/** Patrimônio: aquisição, residual e custos mensais */
export const ASSET_MONEY_FIELDS = [
  ...columnsOf('Asset'),
  // O que as respostas do patrimônio calculam (módulo 4); residualValue já
  // é coluna (legada)
  'depreciableValue',
  'monthlyDepreciation',
  'depreciatedValue',
  'remainingValue',
  'ownCost',
  'unitCost',
  'monthlyCost',
  'salePrice',
  'averageCost',
];

/**
 * Relatórios de venda que o painel inicial usa: resumo, evolução e
 * rankings. As contagens, os nomes e o tempo de aprovação ficam
 */
export const DASHBOARD_SALES_MONEY_FIELDS = [
  'approvedTotal',
  'rejectedTotal',
  'noResponseTotal',
  'expiredTotal',
  'canceledTotal',
  'averageTicket',
  'commission',
  // Evolução (por dia, mês e ano) e rankings
  'approved',
  'value',
];

/** Totais do fluxo financeiro: ficam as contagens de pagos e vencidos */
export const FLOW_TOTALS_MONEY_FIELDS = [
  'expected',
  'totalPaid',
  'open',
  'overdue',
];

/** Orçamento: lista, exportação, detalhe, pagamento e dados do PDF */
export const QUOTATION_MONEY_FIELDS = [
  ...columnsOf(
    'Quotation',
    'QuotationProduct',
    'QuotationItemLine',
    'QuotationProductItem',
    'QuotationPayment',
    'Commission',
    'QuotationInstallment',
    'DeliveryInfo',
  ),
  // Desconto máximo do perfil do vendedor, que o detalhe traz
  'maxDiscount',
  // Nomes que as respostas calculam ou trocam (quotation.transformers e
  // quotation-pdf.transformers). `total` não entra: na lista é a contagem
  'unitValue',
  'originalValue',
  'amount',
  'freightCost',
  'freightPrice',
  'subtotal',
  'totalDiscount',
  'commissionTotal',
  'finalTotal',
];

/** O.S.: os valores da venda e as parcelas da tabela financeira */
export const ORDER_MONEY_FIELDS = [
  ...QUOTATION_MONEY_FIELDS,
  'dueAmount',
  'paidAmount',
];
