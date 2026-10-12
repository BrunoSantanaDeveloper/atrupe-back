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
  sale: ['quotation', 'other_quotation', 'order'],
  financial: ['flow', 'cash_control', 'fixed_expense', 'payroll'],
  cost: ['base', 'pricing'],
  production: ['production', 'delivery_schedule'],
  stock: ['stock', 'invoice_entry'],
  reports: ['sector_result', 'sales', 'financial', 'dfc', 'commission'],
  register: ['client', 'supplier', 'credit_limit'],
  company_settings: [
    'company',
    'measurement_standards',
    'users',
    'roles',
    'sectors',
  ],
  product_settings: ['products'],
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
  ],
  nota_fiscal: ['emitir', 'emitidas', 'cancelar', 'carta_correcao', 'config'],
};

/**
 * Recursos fora do catálogo que ainda valem: cargos gravados antes da tela
 * atual os têm, e as rotas os aceitam junto com a chave do catálogo.
 * - `sale:other_sellers`: hoje `sale:other_quotation`
 *   (src/scripts/normalize-other-sellers-permission.ts migra os cargos).
 * - `financial:payable` e `financial:receivable`: as telas de contas a pagar
 *   e a receber pedem estas chaves, mas a tela de cargos concede só
 *   `financial:flow`; as rotas aceitam as duas.
 */
export const LEGACY_RESOURCES: readonly string[] = [
  'sale:other_sellers',
  'financial:payable',
  'financial:receivable',
];

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
