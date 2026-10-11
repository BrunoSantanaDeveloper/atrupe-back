import { rolesForPlan } from './roles';
import { START } from './start';
import { PlanFixture } from './types';

/**
 * LITE — o START mais setores e etapas, status e motivos, contas bancárias,
 * caixa, venda rápida, contas a receber e a pagar. Usuários: os do START e o
 * Caixa como 4º usuário (additionalUsers: 1).
 *
 * Dados v1: os do START.
 *
 * TODO (próximas fatias, pela API que já existe): 4 setores marcados como
 * etapa e produtos com etapas; 4 status de orçamento em uso; 3 motivos de
 * rejeição e 2 de cancelamento de O.S. usados nos documentos; 2 contas
 * bancárias fictícias além do Caixa e uma condição com taxa de operadora;
 * caixa do dia aberto com 5 movimentos e o do dia anterior fechado; 3 vendas
 * rápidas; 10 contas a receber (3 vencidas, 2 pagas com diferença) e 8 a
 * pagar; limite de crédito configurado; 1 cliente com responsável e abas
 * extras; 1 filial (multiple_companies).
 */
export const LITE: PlanFixture = {
  ...START,
  planType: 'LITE',
  additionalUsers: 1,
  roles: rolesForPlan('LITE'),
};
