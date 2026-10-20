/**
 * O que "zerar dados da conta" apaga, em que ordem, e o que fica.
 *
 * A ordem respeita as chaves estrangeiras: filho antes do pai. Duas chaves
 * ficam de fora de propósito porque o banco as anula sozinho (ON DELETE SET
 * NULL): o vínculo da conta bancária com o caixa e o da nota fiscal com o
 * orçamento e a O.S. — por isso nota fiscal pode ficar quando o resto sai.
 *
 * O teste do plano cruza esta lista com o schema: um modelo novo com
 * `companyId` que não esteja aqui nem em `KEPT_MODELS` faz o teste falhar, e
 * uma referência obrigatória (ou opcional com Restrict) a um modelo apagado
 * também.
 */

export type ResetGroup =
  | 'fiscal'
  | 'documents'
  | 'financial'
  | 'stock'
  | 'registries'
  | 'payroll'
  | 'settings';

export interface ResetStep {
  /** Nome do modelo no schema (PascalCase). */
  model: string;
  /** Como aparece na prévia; vazio para as tabelas filhas, contadas junto. */
  label?: string;
  group: ResetGroup;
  where: (companyId: string) => Record<string, any>;
}

export interface ResetOptions {
  /** Apaga as notas fiscais (que, se ficarem, só perdem o vínculo). */
  includeFiscalDocuments: boolean;
  /**
   * Apaga as configurações e recria o padrão de conta nova (séries,
   * condições, categorias, conta bancária e os exemplos do cadastro).
   */
  restoreDefaults: boolean;
}

export const GROUP_LABELS: Record<ResetGroup, string> = {
  fiscal: 'Notas fiscais',
  documents: 'Orçamentos e ordens de serviço',
  financial: 'Financeiro',
  stock: 'Estoque',
  registries: 'Cadastros',
  payroll: 'Folha de pagamento',
  settings: 'Configurações',
};

const byQuotation = (companyId: string) => ({ quotation: { companyId } });
const byOrder = (companyId: string) => ({
  order: { quotation: { companyId } },
});

/** Os passos, na ordem em que rodam. */
export const RESET_STEPS: ResetStep[] = [
  // Notas fiscais (só com a opção).
  {
    model: 'NfeCorrectionDocument',
    group: 'fiscal',
    where: (companyId) => ({ correctionEvent: { nfe: { companyId } } }),
  },
  {
    model: 'NfeCorrectionEvent',
    group: 'fiscal',
    where: (companyId) => ({ nfe: { companyId } }),
  },
  {
    model: 'NfeDanfeDocument',
    group: 'fiscal',
    where: (companyId) => ({ nfe: { companyId } }),
  },
  {
    model: 'NfeOrder',
    group: 'fiscal',
    where: (companyId) => ({ nfe: { companyId } }),
  },
  {
    model: 'Nfe',
    label: 'NF-e',
    group: 'fiscal',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Nfse',
    label: 'NFS-e',
    group: 'fiscal',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Nfce',
    label: 'NFC-e',
    group: 'fiscal',
    where: (companyId) => ({ companyId }),
  },

  // Produção, entrega, O.S. e orçamentos.
  {
    model: 'ProductionTimeEntry',
    group: 'documents',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ProductionTask',
    group: 'documents',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ProductionProject',
    label: 'Projetos de produção',
    group: 'documents',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'PendingSale',
    label: 'Vendas na fila do caixa',
    group: 'documents',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ProductionStage',
    group: 'documents',
    where: (companyId) => ({ schedule: { companyId } }),
  },
  {
    model: 'DeliverySchedule',
    label: 'Agendamentos de entrega',
    group: 'documents',
    where: (companyId) => ({ companyId }),
  },
  { model: 'OrderHistory', group: 'documents', where: byOrder },
  // O vínculo entre nota e O.S. sai com a O.S.; a nota, se ficar, segue.
  { model: 'NfeOrder', group: 'documents', where: byOrder },
  {
    model: 'Order',
    label: 'Ordens de serviço',
    group: 'documents',
    where: byQuotation,
  },
  { model: 'DeliveryInfo', group: 'documents', where: byQuotation },
  { model: 'QuotationHistory', group: 'documents', where: byQuotation },
  {
    model: 'QuotationInstallment',
    group: 'documents',
    where: (companyId) => ({ quotationPayment: { quotation: { companyId } } }),
  },
  { model: 'QuotationPayment', group: 'documents', where: byQuotation },
  {
    model: 'QuotationProductItem',
    group: 'documents',
    where: (companyId) => ({ quotationProduct: { quotation: { companyId } } }),
  },
  { model: 'QuotationProduct', group: 'documents', where: byQuotation },
  // O rascunho do item montado na hora leva junto a composição dele.
  {
    model: 'QuotationDraft',
    group: 'documents',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Quotation',
    label: 'Orçamentos',
    group: 'documents',
    where: (companyId) => ({ companyId }),
  },

  // Financeiro.
  {
    model: 'ReceivableHistory',
    group: 'financial',
    where: (companyId) => ({ receivable: { companyId } }),
  },
  {
    model: 'ReceivableInstallment',
    group: 'financial',
    where: (companyId) => ({ receivable: { companyId } }),
  },
  {
    model: 'Receivable',
    label: 'Contas a receber',
    group: 'financial',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'PayableHistory',
    group: 'financial',
    where: (companyId) => ({ payable: { companyId } }),
  },
  {
    model: 'PayableInstallment',
    group: 'financial',
    where: (companyId) => ({ payable: { companyId } }),
  },
  {
    model: 'Commission',
    label: 'Comissões',
    group: 'financial',
    where: (companyId) => ({
      OR: [{ supplier: { companyId } }, { payable: { companyId } }],
    }),
  },
  {
    model: 'Payable',
    label: 'Contas a pagar',
    group: 'financial',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'BankStatementLine',
    label: 'Extratos importados',
    group: 'financial',
    where: (companyId) => ({ companyId }),
  },
  // A baixa em conta sem controle de caixa entra direto na conta, sem caixa.
  {
    model: 'Transaction',
    label: 'Movimentações de caixa',
    group: 'financial',
    where: (companyId) => ({
      OR: [{ cashRegister: { companyId } }, { bankAccount: { companyId } }],
    }),
  },
  {
    model: 'CashSession',
    label: 'Sessões da frente de caixa',
    group: 'financial',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'CashRegister',
    label: 'Caixas',
    group: 'financial',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ScheduledExpense',
    label: 'Despesas programadas',
    group: 'financial',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'FinancialFlow',
    label: 'Lançamentos de fluxo',
    group: 'financial',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Invoice',
    label: 'Faturas',
    group: 'financial',
    where: (companyId) => ({ companyId }),
  },

  // Estoque: os saldos, os movimentos e as entradas de nota.
  {
    model: 'StockMovement',
    label: 'Movimentos de estoque',
    group: 'stock',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'StockItem',
    label: 'Saldos de estoque',
    group: 'stock',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'InboundInvoice',
    label: 'Entradas de nota',
    group: 'stock',
    where: (companyId) => ({ companyId }),
  },

  // Cadastros: clientes, fornecedores, produtos e patrimônio.
  {
    model: 'ClientPaymentCondition',
    group: 'registries',
    where: (companyId) => ({ client: { companyId } }),
  },
  {
    model: 'SupplierPaymentCondition',
    group: 'registries',
    where: (companyId) => ({ supplier: { companyId } }),
  },
  {
    model: 'Contact',
    group: 'registries',
    where: (companyId) => ({
      OR: [{ client: { companyId } }, { supplier: { companyId } }],
    }),
  },
  // Só os endereços de clientes e fornecedores; o da empresa e os dos
  // colaboradores ficam.
  {
    model: 'Address',
    group: 'registries',
    where: (companyId) => ({
      OR: [{ client: { companyId } }, { supplier: { companyId } }],
    }),
  },
  {
    model: 'Client',
    label: 'Clientes',
    group: 'registries',
    where: (companyId) => ({ companyId }),
  },
  // O vínculo do item da nota do fornecedor com o material.
  {
    model: 'SupplierItemLink',
    group: 'registries',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Supplier',
    label: 'Fornecedores',
    group: 'registries',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ProductFiscalData',
    group: 'registries',
    where: (companyId) => ({ product: { companyId } }),
  },
  {
    model: 'ProductStRule',
    group: 'registries',
    where: (companyId) => ({ product: { companyId } }),
  },
  {
    model: 'ProductItem',
    group: 'registries',
    where: (companyId) => ({ product: { companyId } }),
  },
  // A composição sai antes do produto: a etapa "parte" aponta para outro.
  {
    model: 'ProductAssembly',
    group: 'registries',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Product',
    label: 'Produtos',
    group: 'registries',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Process',
    label: 'Processos',
    group: 'registries',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'MaterialImportLink',
    group: 'registries',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Material',
    label: 'Materiais',
    group: 'registries',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Asset',
    label: 'Patrimônio',
    group: 'registries',
    where: (companyId) => ({ companyId }),
  },

  // Folha.
  {
    model: 'PayrollItem',
    group: 'payroll',
    where: (companyId) => ({ payroll: { companyId } }),
  },
  {
    model: 'Payroll',
    label: 'Folhas de pagamento',
    group: 'payroll',
    where: (companyId) => ({ companyId }),
  },

  // Configurações (só com a opção de voltar ao padrão de conta nova).
  {
    model: 'CreditLimitPaymentCondition',
    group: 'settings',
    where: (companyId) => ({ creditLimitDefault: { companyId } }),
  },
  {
    model: 'CreditLimitDefault',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'BankAccountCashControl',
    group: 'settings',
    where: (companyId) => ({ bankAccount: { companyId } }),
  },
  {
    model: 'Installment',
    group: 'settings',
    where: (companyId) => ({ paymentCondition: { companyId } }),
  },
  {
    model: 'PaymentCondition',
    label: 'Condições de pagamento',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'BankAccount',
    label: 'Contas bancárias',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'SubCategory',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Nature',
    label: 'Naturezas financeiras',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Category',
    label: 'Categorias',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'SaleSeries',
    label: 'Séries de venda',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'QuotationTag',
    label: 'Etiquetas',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'Reasons',
    label: 'Motivos',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'AssetType',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'PayrollSetup',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'PayrollTemplate',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'SaleSettings',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'QuickSaleSettings',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'CashFront',
    label: 'Frentes de caixa',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'PricingParameters',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'CostBaseExpense',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  // Sem ela, os grupos de patrimônio padrão voltam a ser criados.
  {
    model: 'CostBaseSettings',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'AssetGroup',
    label: 'Grupos de patrimônio',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  // A etapa do tipo de tarefa aponta para o gerenciador: sai antes dele.
  {
    model: 'ProductionTaskStep',
    group: 'settings',
    where: (companyId) => ({ taskType: { companyId } }),
  },
  {
    model: 'ProductionTaskType',
    label: 'Tipos de tarefa da produção',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ProductionManager',
    label: 'Gerenciadores de produção',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ProductionFlow',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ProductionCollaborator',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ProductionCalendar',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
  {
    model: 'ProductionVehicle',
    label: 'Frota',
    group: 'settings',
    where: (companyId) => ({ companyId }),
  },
];

/**
 * Modelos com `companyId` que o "zerar" nunca toca: a conta, os acessos, a
 * assinatura e a cobrança, o fiscal (certificado, emissores e numeração), as
 * trilhas de auditoria e a carga horária dos colaboradores por setor.
 */
export const KEPT_MODELS = [
  'CompanyHistory',
  'CompanySector',
  'Role',
  'SellerProfile',
  'Employee',
  'Language',
  'ContactSource',
  'CompanyHiddenContactSource',
  'Plan',
  'Customer',
  'Subscription',
  'CouponUsage',
  'ContractAcceptance',
  'OwnershipTransfer',
  'OwnershipPeriod',
  'AcademyProgress',
  'UserActivity',
  'UserActivityEvent',
  'AiConversation',
  'MigrationRun',
  'ImportLog',
  'InvoicyConfig',
  'InvoicyConfigHistory',
  'CfopConfig',
  'OperationNature',
  'NfseServico',
  'DigitalCertificate',
  'FiscalOnboardingRequest',
  'CompanyEnvironmentCredential',
  'CompanyDataReset',
  'CostAuditLog',
  'EmployeeWorkload',
];

/** Os passos que rodam com as opções escolhidas. */
export function stepsFor(options: ResetOptions): ResetStep[] {
  return RESET_STEPS.filter((step) => {
    if (step.group === 'settings') return options.restoreDefaults;
    // O vínculo nota × O.S. da etapa fiscal só roda quando as notas saem; o
    // da etapa de documentos roda sempre (sai com a O.S.).
    if (step.group === 'fiscal') return options.includeFiscalDocuments;
    return true;
  });
}

/** O nome do delegate do Prisma: o modelo com a inicial minúscula. */
export const delegateOf = (model: string) =>
  model.charAt(0).toLowerCase() + model.slice(1);
