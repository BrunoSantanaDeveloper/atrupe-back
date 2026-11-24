import { BadRequestException } from '@nestjs/common';

import type { PlanControlService } from '../../plan/plan-control.service';

const FEATURE = 'service_order_cancellation_reason';

/**
 * O motivo do cancelamento da O.S. O cadastro de motivos é recurso de plano
 * (LITE). Com ele, o motivo é obrigatório (decisão do produto, 24/10/2026);
 * sem ele, cancela livre. Sem nenhum motivo de cancelamento cadastrado, a
 * tela não teria o que oferecer: o cancelamento segue livre até a empresa
 * cadastrar um. Vale na rota de cancelar e em refazer a O.S. (GP-51), que
 * cancela a antiga.
 */
export async function assertCancelReason(
  plan: Pick<PlanControlService, 'hasFeature' | 'enforceFeature'>,
  countReasons: (companyId: string) => Promise<number>,
  companyId: string,
  reasonId?: string | null,
) {
  const hasReasons = await plan.hasFeature(companyId, FEATURE);
  const required = hasReasons && (await countReasons(companyId)) > 0;
  if (required && !reasonId) {
    throw new BadRequestException('Informe o motivo do cancelamento');
  }
  if (reasonId && !hasReasons) {
    await plan.enforceFeature(companyId, FEATURE);
  }
}
