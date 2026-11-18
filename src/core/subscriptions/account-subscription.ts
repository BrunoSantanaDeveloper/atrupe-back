import { Prisma } from '@prisma/client';

/**
 * As abas de Gerenciar contas, na ordem dos totais. A lista é uma só para os
 * totais e para a validação da listagem: quando eram duas, a aba Aguardando
 * pagamento contava a conta e a lista dela voltava vazia.
 */
export const ACCOUNT_TABS = [
  'ativas',
  'bloqueadas',
  'aguardando',
  'inativas',
  'canceladas',
] as const;

/**
 * As assinaturas que a gestão de contas do superadmin enxerga: as de plano
 * pago, fora as contratações que não chegaram ao fim — a reserva `temp_` (em
 * curso ou largada no meio) e a desfeita (`ABANDONED`).
 *
 * Sem esse corte, uma evolução que falhou no gateway virava a assinatura mais
 * recente da conta, e um Start aparecia como Lite. Uma conta trial que tentou
 * contratar e não concluiu caía em Canceladas.
 */
export const ACCOUNT_SUBSCRIPTION_WHERE = {
  plan: { planType: { not: 'TRIAL' } },
  NOT: { asaasSubscriptionId: { startsWith: 'temp_' } },
  // `not` não casa nulo: sem o `null`, as assinaturas em curso sumiriam.
  OR: [{ endedReason: null }, { endedReason: { not: 'ABANDONED' } }],
} satisfies Prisma.SubscriptionWhereInput;

/**
 * Módulo contratado: o que a assinatura tem à parte e é cobrado. Recurso
 * mantido ao sair do plano ou cortesia (`grantSource`) não é módulo — é a
 * mesma regra da contratação de complementos.
 */
export const CONTRACTED_MODULE_WHERE = {
  isActive: true,
  grantSource: null,
} satisfies Prisma.SubscriptionFeatureWhereInput;

/**
 * A assinatura em vigor da conta: a ACTIVE mais recente ou, sem nenhuma
 * ativa, a mais recente. Recebe a lista ordenada da mais nova para a mais
 * antiga.
 */
export function currentAccountSubscription<T extends { status: string }>(
  subscriptions: T[],
): T | undefined {
  return subscriptions.find((s) => s.status === 'ACTIVE') ?? subscriptions[0];
}
