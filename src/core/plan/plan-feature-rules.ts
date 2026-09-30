/**
 * Regras dos recursos de plano que pertencem ao CÓDIGO.
 *
 * A composição de cada plano (quais recursos ele inclui) é dado: fica em
 * `plan_features` e é o superadmin quem decide, no painel de planos. O que
 * cada chave libera, de quais outras ela depende e onde ela é aplicada
 * continua aqui, porque só um deploy muda isso.
 */

/** Todas as chaves de recurso de plano que o código conhece. */
export const PLAN_FEATURE_KEYS = [
  'pdf_show_item_details',
  'sectors_configuration',
  'service_order_current_phase',
  'quotation_quick_sale',
  'quotation_rejection_reasons',
  'quotation_require_rejection_reason',
  'service_order_cancellation_reason',
  'quotation_status_configuration',
  'quotation_status_column',
  'delivery_production_tabs',
  'delivery_production_stages',
  'delivery_stage_status_change',
  'accounts_receivable',
  'accounts_payable',
  'cash_control',
  'bank_account_cash_control_switch',
  'pdv_screen',
  'bank_account_creation',
  'payment_condition_operator_fee',
  'credit_limit_configuration',
  'product_composition',
  'product_production_stages',
  'client_additional_tabs',
  'supplier_additional_tabs',
  'client_responsible_management',
  'bank_account_delete',
  'bank_account_provision',
  'payment_difference',
] as const;

export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];

export const isPlanFeatureKey = (key: string): key is PlanFeatureKey =>
  (PLAN_FEATURE_KEYS as readonly string[]).includes(key);

/**
 * Dependências: a chave só funciona com as que ela exige. O painel não deixa
 * ligar uma chave sem as que ela exige, nem desligar uma exigida enquanto
 * houver dependente ligado — a não ser com a cascata explícita.
 */
export const FEATURE_DEPENDENCIES: Partial<
  Record<PlanFeatureKey, PlanFeatureKey[]>
> = {
  // As etapas e a mudança de status aparecem dentro das abas de produção.
  delivery_production_stages: ['delivery_production_tabs'],
  delivery_stage_status_change: ['delivery_production_tabs'],
  // As etapas de produção são setores marcados como etapa.
  product_production_stages: ['sectors_configuration'],
  // O switch só tem efeito com o controle de caixa.
  bank_account_cash_control_switch: ['cash_control'],
  // Os motivos usados ao rejeitar e cancelar vêm do mesmo cadastro.
  quotation_require_rejection_reason: ['quotation_rejection_reasons'],
  service_order_cancellation_reason: ['quotation_rejection_reasons'],
  // A coluna mostra os status personalizados.
  quotation_status_column: ['quotation_status_configuration'],
};

/** Quem depende de `key` (inverso de FEATURE_DEPENDENCIES). */
export function dependentsOf(key: string): PlanFeatureKey[] {
  return (Object.keys(FEATURE_DEPENDENCIES) as PlanFeatureKey[]).filter((k) =>
    FEATURE_DEPENDENCIES[k]?.includes(key as PlanFeatureKey),
  );
}

/**
 * Onde o recurso é aplicado quando o plano não o inclui:
 * - `api`: o servidor recusa (403) — e a tela também esconde;
 * - `tela`: só a interface esconde (é exibição, ou não há API a proteger);
 * - `nenhum`: a chave ainda não muda nada no sistema.
 */
export type FeatureEnforcementLevel = 'api' | 'tela' | 'nenhum';

export const FEATURE_ENFORCEMENT: Record<
  PlanFeatureKey,
  { level: FeatureEnforcementLevel; detail: string }
> = {
  pdf_show_item_details: {
    level: 'tela',
    detail:
      'O PDF é montado na tela; a API entrega os dados do orçamento de qualquer forma.',
  },
  sectors_configuration: {
    level: 'api',
    detail: 'Criar, editar e excluir setores.',
  },
  service_order_current_phase: {
    level: 'tela',
    detail: 'Coluna "Fase atual" na lista de ordens de serviço.',
  },
  quotation_quick_sale: {
    level: 'api',
    detail:
      'Criar orçamento como venda rápida. Ainda não há botão de entrada na tela.',
  },
  quotation_rejection_reasons: {
    level: 'api',
    detail: 'Cadastro de motivos e motivo ao rejeitar orçamento.',
  },
  quotation_require_rejection_reason: {
    level: 'nenhum',
    detail:
      'Ainda não muda nada: o motivo continua opcional ao rejeitar (decisão pendente).',
  },
  service_order_cancellation_reason: {
    level: 'api',
    detail: 'Motivo ao cancelar ordem de serviço.',
  },
  quotation_status_configuration: {
    level: 'api',
    detail: 'Criar, editar e excluir status de orçamento.',
  },
  quotation_status_column: {
    level: 'tela',
    detail: 'Coluna "Status" na lista de orçamentos.',
  },
  delivery_production_tabs: {
    level: 'api',
    detail: 'Abas "Produção" e "Todos" da agenda de entrega.',
  },
  delivery_production_stages: {
    level: 'tela',
    detail: 'Etapas exibidas na lista da agenda de entrega.',
  },
  delivery_stage_status_change: {
    level: 'api',
    detail: 'Alterar o status das etapas de produção.',
  },
  accounts_receivable: {
    level: 'api',
    detail: 'Tela de contas a receber (a lista).',
  },
  accounts_payable: {
    level: 'api',
    detail: 'Tela de contas a pagar (a lista).',
  },
  cash_control: {
    level: 'api',
    detail: 'Controle de caixa inteiro (abrir, fechar, transferir, listar).',
  },
  bank_account_cash_control_switch: {
    level: 'api',
    detail:
      'Ligar ou desligar o controle de caixa de uma conta bancária (sem o recurso, a API ignora a mudança).',
  },
  pdv_screen: {
    level: 'tela',
    detail: 'A frente de caixa ainda não tem API: só a tela é bloqueada.',
  },
  bank_account_creation: {
    level: 'api',
    detail: 'Criar contas bancárias.',
  },
  payment_condition_operator_fee: {
    level: 'api',
    detail: 'Informar ou alterar a taxa da operadora e o repasse.',
  },
  credit_limit_configuration: {
    level: 'api',
    detail: 'Limite de crédito padrão e limite por cliente.',
  },
  product_composition: {
    level: 'api',
    detail:
      'Incluir composição em produto (produto já composto segue editável).',
  },
  product_production_stages: {
    level: 'api',
    detail: 'Incluir etapas no produto e marcar setor como etapa de produção.',
  },
  client_additional_tabs: {
    level: 'api',
    detail:
      'Orçamentos, ordens de serviço e financeiro filtrados pelo cliente.',
  },
  supplier_additional_tabs: {
    level: 'api',
    detail: 'Financeiro filtrado pelo fornecedor.',
  },
  client_responsible_management: {
    level: 'api',
    detail: 'Atribuir responsável ao cliente e filtrar a carteira.',
  },
  bank_account_delete: {
    level: 'api',
    detail: 'Excluir contas bancárias.',
  },
  bank_account_provision: {
    level: 'api',
    detail: 'Usar o tipo "provisionar" nas contas bancárias.',
  },
  payment_difference: {
    level: 'api',
    detail: 'Registrar a diferença no recebimento ou pagamento.',
  },
};

/** Rótulos das categorias do catálogo (`Feature.category` é texto livre). */
export const FEATURE_CATEGORY_LABELS: Record<string, string> = {
  configuration: 'Empresa e sistema',
  clients: 'Clientes',
  suppliers: 'Fornecedores',
  quotations: 'Orçamentos',
  service_orders: 'Ordens de serviço',
  pdf: 'Impressão',
  delivery: 'Produção e entrega',
  products: 'Produtos',
  financial: 'Financeiro',
};

/** Ordem das categorias na matriz do painel. */
export const FEATURE_CATEGORY_ORDER = [
  'configuration',
  'clients',
  'suppliers',
  'quotations',
  'service_orders',
  'pdf',
  'delivery',
  'products',
  'financial',
];

/**
 * Assinaturas "atuais" de um plano, para contar quem é atingido por uma
 * mudança e quem mantém um recurso retirado do plano: ativas ou bloqueadas
 * (o bloqueio é temporário). Reservas de contratação (`temp_`) ficam fora.
 */
export const CURRENT_SUBSCRIPTION_STATUSES = ['ACTIVE', 'BLOCKED'] as const;

/** Origem de um recurso concedido a uma assinatura fora do plano. */
export const GRANT_SOURCE = {
  PLAN_RETAINED: 'PLAN_RETAINED',
  COURTESY: 'COURTESY',
} as const;
