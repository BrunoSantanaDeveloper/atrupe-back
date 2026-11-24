/**
 * As chaves de permissão que a tela de cargos concede: `seção:item:ação`.
 *
 * Espelha o catálogo da tela (app-web, src/consts/permissions.ts); quando a
 * tela ganhar um item, ele entra aqui também. permission-catalog.spec.ts
 * confere que todo decorator de permissão usa uma chave daqui: uma chave
 * com erro de digitação nenhum cargo recebe, e a rota fica só para o
 * administrador.
 */
export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
] as const;

export const PERMISSION_CATALOG: Readonly<Record<string, readonly string[]>> = {
  values: ['values'],
  dashboard: ['financial', 'sales', 'quotations', 'rankings'],
  // quotation_result: o resultado previsto da venda (ORC-8), tela de
  // método desligada no perfil de vendedor
  sale: ['quotation', 'other_quotation', 'order', 'quotation_result'],
  // payable, receivable, pdv e checkout: as telas já pediam e a tela de
  // cargos passou a conceder (decisão do PO, 14/10)
  financial: [
    'flow',
    'cash_control',
    // Reabrir caixa fechado (ALT-7), dispensar o sinal e reverter a venda
    // rápida para faturamento (PO, 13/10/2026): chaves próprias (Fase 7)
    'cash_control_reopen',
    'pdv_down_payment',
    'pdv_billing',
    // "Configurar frente de caixa" (FC-15): o cadastro das frentes
    'pdv_settings',
    'fixed_expense',
    'payroll',
    'payable',
    'receivable',
    'pdv',
    'checkout',
  ],
  cost: ['base', 'pricing'],
  // Corrigir e lançar tempo (GP-44) e a produtividade por pessoa (PCP-3),
  // chaves novas do gerenciador (Fase 6)
  // Concluir tudo de uma vez na Agenda de entrega (§4.7; Maicol, 23/11/2026):
  // a ação gerencial de limpar a agenda
  production: [
    'production',
    'delivery_schedule',
    'delivery_schedule_finish_all',
    // Agendar, fechar e cancelar as saídas dos veículos (fase 1)
    'vehicle_schedule',
    'time_entry',
    'productivity',
  ],
  // Compras e lotes do FULL (ES-8 a ES-17): a solicitação é aberta a
  // quem tem a chave; cotação e pedido são de quem compra
  stock: ['stock', 'invoice_entry', 'purchase_request', 'purchase', 'lot'],
  reports: ['sector_result', 'sales', 'financial', 'dfc', 'commission'],
  register: ['client', 'supplier', 'credit_limit'],
  company_settings: [
    'company',
    'measurement_standards',
    'users',
    'roles',
    'sectors',
    // A assinatura saiu do cargo (pacote de 26/10/2026): só o administrador
    // a vê e gerencia
  ],
  // composition: a composição por etapas, os processos e os recursos (D18)
  product_settings: ['products', 'composition'],
  financial_settings: [
    'bank_accounts',
    'payment_methods',
    'chart_accounts',
    'fixed_expenses',
    'credit_limits',
    'payroll',
  ],
  sales_settings: [
    'series',
    'seller_profile',
    'rejection_reasons',
    'quotation_status',
    'contact_sources',
  ],
  nota_fiscal: ['emitir', 'emitidas', 'cancelar', 'carta_correcao', 'config'],
  // CFOP, naturezas de operação e emissores
  invoice: ['nfse'],
  import_settings: [
    'import',
    'clients',
    'suppliers',
    'products',
    'quotations',
    'financial',
  ],
  academy: ['academy'],
};

/**
 * Recursos fora do catálogo que ainda valem: cargos gravados antes da tela
 * atual os têm, e as rotas os aceitam junto com a chave do catálogo.
 * - `sale:other_sellers`: hoje `sale:other_quotation`
 *   (src/scripts/normalize-other-sellers-permission.ts migra os cargos).
 */
export const LEGACY_RESOURCES: readonly string[] = ['sale:other_sellers'];

export function isCatalogResource(resource: string): boolean {
  const [section, item, ...rest] = resource.split(':');
  return (
    rest.length === 0 && !!PERMISSION_CATALOG[section]?.includes(item ?? '')
  );
}

export function isKnownResource(resource: string): boolean {
  return isCatalogResource(resource) || LEGACY_RESOURCES.includes(resource);
}

/** A permissão gravada num cargo: `'*'` ou `seção:item:ação` conhecida. */
export function isKnownPermission(permission: string): boolean {
  if (permission === '*') return true;
  const parts = permission.split(':');
  if (parts.length !== 3) return false;
  const [section, item, action] = parts;
  return (
    isKnownResource(`${section}:${item}`) &&
    (PERMISSION_ACTIONS as readonly string[]).includes(action)
  );
}
