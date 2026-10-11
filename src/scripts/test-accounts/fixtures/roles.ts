import { planRank, TestPlanType } from '../options';
import { RoleFixture } from './types';

/**
 * Cargos das contas de teste e as permissões de cada um, por plano.
 *
 * Formato `secao:item:acao` do catálogo de permissões do app-web
 * (src/consts/permissions.ts); editar, criar e excluir já implicam ver
 * (abac.service.ts). Nenhum cargo operacional recebe custo, precificação,
 * composição em edição nem resultado previsto (SEG-6).
 *
 * Pendências que fecham esta lista:
 * - `values:values:view` no Vendedor é decisão do PO (o contrato condiciona
 *   custo e preço a ela); fica de fora até a decisão;
 * - o catálogo do fork muda as chaves de caixa e de produção: a lista fecha
 *   depois do merge dos catálogos de permissão;
 * - ELITE: `production:production:*` (gerenciador) entra quando a chave
 *   existir no catálogo do app-web.
 */

function actions(resource: string, ...names: string[]): string[] {
  return names.map((name) => `${resource}:${name}`);
}

const VENDEDOR = [
  ...actions('sale:quotation', 'view', 'create', 'edit', 'delete', 'export'),
  ...actions('sale:order', 'view'),
  ...actions('register:client', 'view', 'create', 'edit'),
  ...actions('dashboard:sales', 'view'),
  ...actions('dashboard:quotations', 'view'),
];

const PRODUCAO = [...actions('sale:order', 'view', 'edit')];

/** LITE: agenda de entrega (abas de produção e etapas). */
const PRODUCAO_LITE = [
  ...PRODUCAO,
  ...actions('production:delivery_schedule', 'view', 'edit'),
];

/** LITE: frente de caixa, venda rápida e baixa no financeiro. */
const CAIXA = [
  ...actions('financial:cash_control', 'view', 'create', 'edit'),
  ...actions('financial:flow', 'view', 'edit'),
  ...actions('sale:quotation', 'view', 'create'),
  ...actions('register:client', 'view'),
];

const LITE_RANK = planRank('LITE');

/** Cargos do plano, além do Administrador (titular da conta). */
export function rolesForPlan(planType: TestPlanType): RoleFixture[] {
  const fromLite = planRank(planType) >= LITE_RANK;

  const roles: RoleFixture[] = [
    {
      cargo: 'vendedor',
      roleName: 'Vendedor',
      sectorName: 'Comercial',
      personName: 'Vendedor (teste)',
      permissions: VENDEDOR,
      sellerProfile: {
        name: 'Vendedor',
        commission: 5,
        maxDiscount: 10,
        minValue: 0,
      },
    },
    {
      cargo: 'producao',
      roleName: 'Produção',
      sectorName: 'Produção',
      personName: 'Produção (teste)',
      permissions: fromLite ? PRODUCAO_LITE : PRODUCAO,
    },
  ];

  // O START fica no limite (3 de 3): o 4º usuário é o teste do
  // PLAN_LIMIT_REACHED. Do LITE para cima, o Caixa entra como usuário
  // adicional (additionalUsers: 1).
  if (fromLite) {
    roles.push({
      cargo: 'caixa',
      roleName: 'Caixa',
      sectorName: 'Comercial',
      personName: 'Caixa (teste)',
      permissions: CAIXA,
    });
  }

  return roles;
}
