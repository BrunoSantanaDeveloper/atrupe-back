import { PRO } from './pro';
import { rolesForPlan } from './roles';
import { PlanFixture } from './types';

/**
 * ELITE — o PRO mais gerenciador de produção (production_manager) e
 * produtividade (productivity_tracking).
 *
 * Dados v1: os do PRO.
 *
 * TODO (fatias do módulo 3, copiando o mock production-manager.ts):
 * projetos a partir de orçamentos aprovados, tarefas nos seis estados e
 * apontamentos por pessoa, com o usuário Produção apontando.
 */
export const ELITE: PlanFixture = {
  ...PRO,
  planType: 'ELITE',
  roles: rolesForPlan('ELITE'),
};
