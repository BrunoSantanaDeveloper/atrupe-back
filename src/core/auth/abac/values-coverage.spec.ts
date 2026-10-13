import { METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { valuesRuleOf } from './values-visibility.interceptor';

/**
 * Cobertura do helper de valores nas rotas antigas que devolvem dinheiro.
 *
 * Nos controllers de valor, toda leitura decide: omite os campos
 * (@MoneyFields), é recusada sem a permissão (@ValuesOnly) ou está aqui com o
 * motivo. Rota nova num desses controllers sem decidir quebra o teste.
 */

// Os controllers que leem configuração de armazenamento ao carregar
for (const key of [
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY',
  'S3_SECRET_ACCESS_KEY',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET_NAME',
]) {
  process.env[key] = process.env[key] || 'teste';
}
process.env.MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '127.0.0.1';
process.env.MINIO_PORT = process.env.MINIO_PORT || '9000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'teste';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'teste';

/* eslint-disable @typescript-eslint/no-var-requires */
const CONTROLLERS = [
  require('../../product/product.controller').ProductController,
  require('../../sale/quotation/quotation.controller').QuotationController,
  require('../../sale/quotation/payment/payment.controller').PaymentController,
  require('../../sale/order/order.controller').OrderController,
  require('../../asset/asset.controller').AssetController,
  require('../../../svc/report/report.controller').ReportController,
  require('../../financial/flow/flow.controller').FlowController,
  require('../../financial/payable/payable.controller').PayableController,
  require('../../financial/receivable/receivable.controller')
    .ReceivableController,
  require('../../financial/cash-control/cash-control.controller')
    .CashControlController,
  require('../../financial/salaries/salaries.controller').SalariesController,
  require('../../financial/salaries/payroll-templates.controller')
    .PayrollTemplatesController,
  require('../../financial/salary-sheets/salary-sheets.controller')
    .SalarySheetsController,
  require('../../financial/scheduled-expense/scheduled-expense.controller')
    .ScheduledExpenseController,
];
/* eslint-enable @typescript-eslint/no-var-requires */

const CONTAGEM = 'só contagens por situação';
const APOIO = 'lista de apoio, sem valor';

const SEM_VALOR: Record<string, string> = {
  'ProductController.findAllQuantity': CONTAGEM,
  'QuotationController.findAllContactSources': APOIO,
  'QuotationController.findAllQuantity': CONTAGEM,
  'PaymentController.getPaymentConditionsInUse': APOIO,
  'OrderController.findAllQuantity': CONTAGEM,
  'AssetController.quantity': CONTAGEM,
  'ReportController.findAll':
    'menu de relatórios conforme as permissões da sessão',
  'ReportController.getSalesPermissions':
    'menu de relatórios conforme as permissões da sessão',
  'CashControlController.findAllQuantity': CONTAGEM,
  'ScheduledExpenseController.getQuantity': CONTAGEM,
};

const reads = CONTROLLERS.flatMap((klass) =>
  Object.getOwnPropertyNames(klass.prototype)
    .filter(
      (name) =>
        name !== 'constructor' &&
        Reflect.getMetadata(METHOD_METADATA, klass.prototype[name]) ===
          RequestMethod.GET,
    )
    .map((name) => ({
      key: `${klass.name}.${name}`,
      rule: valuesRuleOf(klass.prototype[name], klass),
    })),
);

describe('cobertura do helper de valores', () => {
  it('a varredura acha as leituras', () => {
    expect(CONTROLLERS.every(Boolean)).toBe(true);
    expect(reads.length).toBeGreaterThan(60);
  });

  it('toda leitura dos controllers de valor decidiu', () => {
    const undecided = reads
      .filter((read) => !read.rule && !SEM_VALOR[read.key])
      .map((read) => read.key);
    expect(undecided).toEqual([]);
  });

  it('as exceções existem e continuam sem marca', () => {
    const byKey = new Map(reads.map((read) => [read.key, read]));
    const stale = Object.keys(SEM_VALOR).filter(
      (key) => !byKey.has(key) || byKey.get(key)!.rule,
    );
    expect(stale).toEqual([]);
  });

  it('o detalhe e os dados do PDF do orçamento omitem os valores', () => {
    const fields = (key: string) => {
      const rule = reads.find((read) => read.key === key)?.rule;
      return rule && 'fields' in rule ? [...rule.fields] : [];
    };

    expect(fields('QuotationController.findOne')).toEqual(
      expect.arrayContaining(['totalValue', 'unitValue', 'maxDiscount']),
    );
    expect(fields('QuotationController.getQuotationPdfData')).toEqual(
      expect.arrayContaining(['finalTotal', 'freightPrice', 'subtotal']),
    );
    expect(fields('ProductController.findOne')).toEqual([
      'unitCost',
      'salePrice',
    ]);
  });

  it('as rotas que o painel inicial usa omitem os valores, não recusam', () => {
    for (const key of [
      'ReportController.getSalesSummary',
      'ReportController.getSalesEvolution',
      'ReportController.getTopProducts',
      'ReportController.getTopClients',
      'ReportController.getSalesBySeller',
      'FlowController.findAllTotals',
    ]) {
      const rule = reads.find((read) => read.key === key)?.rule;
      expect({ key, omits: !!rule && 'fields' in rule }).toEqual({
        key,
        omits: true,
      });
    }
  });

  it('o resto dos relatórios e do financeiro é recusado sem a permissão', () => {
    for (const key of [
      'ReportController.getFinancialSummary',
      'ReportController.getCommissionTable',
      'FlowController.findAll',
      'PayableController.findAll',
      'ReceivableController.getReceiptData',
      'SalarySheetsController.getSalarySheetPdfData',
    ]) {
      const rule = reads.find((read) => read.key === key)?.rule;
      expect({ key, rule }).toEqual({ key, rule: { valuesOnly: true } });
    }
  });
});
