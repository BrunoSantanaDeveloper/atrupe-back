import { rolesForPlan } from './roles';
import { START } from './start';
import { PlanFixture } from './types';

/**
 * TRIAL — por padrão de fábrica tem as chaves do START (a coluna é editável
 * no painel de planos), então a conta é a do START com o plano TRIAL: os
 * mesmos 3 usuários e os mesmos dados.
 *
 * O teste gratuito vence pelo `nextDueDate` da assinatura; o script o mantém
 * sempre a mais de 30 dias, para a conta não cair na tela de fim do teste.
 */
export const TRIAL: PlanFixture = {
  ...START,
  planType: 'TRIAL',
  roles: rolesForPlan('TRIAL'),
};
