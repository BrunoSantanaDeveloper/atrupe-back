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
  // 10/10/2026: as do LITE que faltavam, as de PRO, ELITE e FULL e a de
  // faturar na entrega (fora de todo plano até o PO decidir).
  'multiple_companies',
  'transaction_cancel_reasons',
  'can_bill_on_delivery_and_checkout',
  'cost_base',
  'pricing_center',
  'production_manager',
  'productivity_tracking',
  'stock_control',
  'invoice_entry',
  // 14/10/2026: o bloqueio da venda pelo limite de crédito (LITE).
  'credit_limit_enforcement',
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
  service_order_cancellation_reason: ['quotation_rejection_reasons'],
  // A coluna mostra os status personalizados.
  quotation_status_column: ['quotation_status_configuration'],
  // A base de custos e o gerenciador partem da composição do produto.
  cost_base: ['product_composition'],
  production_manager: ['product_composition'],
  // A precificação e o estoque leem os custos prontos.
  pricing_center: ['cost_base'],
  stock_control: ['cost_base'],
  // A produtividade mede o que o gerenciador registra.
  productivity_tracking: ['production_manager'],
  // A entrada de nota alimenta o estoque.
  invoice_entry: ['stock_control'],
  // O bloqueio confere o limite que a configuração cadastra.
  credit_limit_enforcement: ['credit_limit_configuration'],
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
      'Venda rápida (orçamento sem cliente obrigatório): botão em Orçamentos e no menu Vendas.',
  },
  quotation_rejection_reasons: {
    level: 'api',
    detail: 'Cadastro de motivos e motivo ao rejeitar orçamento.',
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
    level: 'api',
    detail:
      'Frente de caixa inteira: sessão do operador, fila das vendas e enviar a venda rápida ao caixa (Fase 7.4).',
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
  multiple_companies: {
    level: 'api',
    detail: 'Criar outra empresa (POST /company).',
  },
  transaction_cancel_reasons: {
    level: 'api',
    detail:
      'Motivo e observação no cancelamento de contas a pagar e a receber.',
  },
  can_bill_on_delivery_and_checkout: {
    level: 'tela',
    detail:
      'Opções de faturamento nas séries e condições (Start em diante, 14/10/2026). Faturar na frente de caixa continua pedindo a frente de caixa.',
  },
  cost_base: {
    level: 'api',
    detail:
      'Patrimônios (/asset) e materiais (/material) já exigem; processos, composição e base de custos exigem quando a API de cada módulo nascer.',
  },
  pricing_center: {
    level: 'tela',
    detail:
      'Telas em implantação; o servidor passa a exigir quando a API da precificação nascer (módulo 4).',
  },
  production_manager: {
    level: 'tela',
    detail:
      'Telas em implantação; o servidor passa a exigir quando a API do gerenciador de produção nascer (módulo 3).',
  },
  productivity_tracking: {
    level: 'tela',
    detail:
      'Telas em implantação; o servidor passa a exigir quando a API da produtividade nascer (módulo 3).',
  },
  stock_control: {
    level: 'api',
    detail: 'Saldo e movimentos do estoque, com o custo médio (Fase 7.5).',
  },
  invoice_entry: {
    level: 'api',
    detail:
      'Entrada de nota pelo XML da NF-e, conciliação com o de-para do fornecedor e entrada no estoque (Fase 7.5).',
  },
  credit_limit_enforcement: {
    level: 'api',
    detail:
      'Aprovação do orçamento recusada com cliente bloqueado, condição fora das permitidas ou saldo acima do limite (antes da data de CREDIT_LIMIT_ENFORCE_FROM, só registra).',
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
  costs: 'Custos e preços',
  production: 'Gerenciador de produção',
  stock: 'Estoque',
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
  'costs',
  'production',
  'stock',
  'financial',
];

/**
 * Regra cumulativa (10/10/2026): nos planos globais, fora o Trial, as chaves
 * ativas de um plano estão contidas nas do plano seguinte, pela `order`
 * (START < LITE < PRO < ELITE < FULL). O Trial é coluna livre da matriz.
 */
export const isCumulativePlanType = (planType: string) => planType !== 'TRIAL';

export interface CumulativeViolation<P> {
  /** O plano de baixo, que tem as chaves. */
  lowerPlan: P;
  /** O plano logo acima, que não as tem. */
  higherPlan: P;
  keys: string[];
}

/**
 * Confere a regra na matriz: cada par de planos vizinhos em que o de cima não
 * tem o que o de baixo tem. Vazio = matriz cumulativa.
 */
export function cumulativeViolations<
  P extends { planType: string; order: number },
>(plans: { plan: P; keys: Iterable<string> }[]): CumulativeViolation<P>[] {
  const chain = plans
    .filter((p) => isCumulativePlanType(p.plan.planType))
    .map((p) => ({ plan: p.plan, keys: new Set(p.keys) }))
    .sort((a, b) => a.plan.order - b.plan.order);
  const violations: CumulativeViolation<P>[] = [];
  for (let i = 1; i < chain.length; i++) {
    const lower = chain[i - 1];
    const higher = chain[i];
    const keys = [...lower.keys].filter((k) => !higher.keys.has(k)).sort();
    if (keys.length) {
      violations.push({ lowerPlan: lower.plan, higherPlan: higher.plan, keys });
    }
  }
  return violations;
}

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
