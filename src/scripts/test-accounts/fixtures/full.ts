import { ELITE } from './elite';
import { rolesForPlan } from './roles';
import { PlanFixture } from './types';

/**
 * FULL — o ELITE mais estoque (stock_control) e entrada de nota
 * (invoice_entry).
 *
 * Dados v1: os do ELITE.
 *
 * TODO (fatias do módulo 5, copiando o mock stock.ts): saldos, movimentos
 * e entradas de nota.
 */
export const FULL: PlanFixture = {
  ...ELITE,
  planType: 'FULL',
  roles: rolesForPlan('FULL'),
};
