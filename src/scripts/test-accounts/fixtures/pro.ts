import { LITE } from './lite';
import { rolesForPlan } from './roles';
import { PlanFixture } from './types';

/**
 * PRO — o LITE mais base de custos (cost_base) e precificação
 * (pricing_center). A conta decide o que aparece (as chaves); o que tem
 * dentro vem do mock do front até cada módulo ter API.
 *
 * Dados v1: os do LITE.
 *
 * TODO (cada fatia do módulo 1A/1B/2/4 traz a sua fixture, copiada do mock
 * que a rota substitui, com os mesmos nomes e números): materiais,
 * processos, composição por etapas, base de custos, rateio por setor,
 * patrimônios e precificação.
 */
export const PRO: PlanFixture = {
  ...LITE,
  planType: 'PRO',
  roles: rolesForPlan('PRO'),
};
