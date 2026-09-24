/**
 * Como uma assinatura é cobrada.
 *
 * - ASAAS_SUBSCRIPTION: assinatura recorrente no Asaas (mensal, ou anual à
 *   vista); o Asaas gera cada renovação.
 * - ASAAS_INSTALLMENT: anual parcelado no cartão. O Asaas não parcela
 *   assinatura: cada ano é uma cobrança parcelada, e a renovação é nossa
 *   (InstallmentRenewalService).
 * - MANUAL e TRIAL: sem cobrança no Asaas.
 *
 * As assinaturas anteriores ao ciclo anual não gravam o modo: ele sai do
 * prefixo do id no Asaas.
 */
export type BillingMode =
  | 'ASAAS_SUBSCRIPTION'
  | 'ASAAS_INSTALLMENT'
  | 'MANUAL'
  | 'TRIAL';

interface WithBillingMode {
  billingMode?: string | null;
  asaasSubscriptionId?: string | null;
  asaasInstallmentId?: string | null;
}

/** Marca o id local de uma assinatura parcelada, que não tem assinatura no Asaas. */
export const INSTALLMENT_SUBSCRIPTION_PREFIX = 'inst_';

export function billingModeOf(subscription: WithBillingMode): BillingMode {
  if (subscription.billingMode) return subscription.billingMode as BillingMode;
  const id = subscription.asaasSubscriptionId ?? '';
  if (id.startsWith('sub_')) return 'ASAAS_SUBSCRIPTION';
  if (id.startsWith(INSTALLMENT_SUBSCRIPTION_PREFIX))
    return 'ASAAS_INSTALLMENT';
  if (id.startsWith('trial_')) return 'TRIAL';
  return 'MANUAL';
}

export function isInstallmentBilling(subscription: WithBillingMode): boolean {
  return billingModeOf(subscription) === 'ASAAS_INSTALLMENT';
}

/**
 * Tem cobrança no Asaas para acompanhar (atraso, bloqueio, sincronização): a
 * assinatura recorrente ou o parcelamento em curso.
 */
export function isBilledByGateway(subscription: WithBillingMode): boolean {
  switch (billingModeOf(subscription)) {
    case 'ASAAS_SUBSCRIPTION':
      return !!subscription.asaasSubscriptionId?.startsWith('sub_');
    case 'ASAAS_INSTALLMENT':
      return !!subscription.asaasInstallmentId;
    default:
      return false;
  }
}

/**
 * O ciclo anual é oferecido, como no protótipo. ANNUAL_CYCLE_ENABLED=false o
 * desliga sem deploy — o parcelamento no cartão depende de comportamentos do
 * Asaas (divisão do total, confirmação das parcelas) que, se falharem em
 * produção, pedem a chave desligada enquanto se corrige.
 */
export function annualCycleEnabled(): boolean {
  return process.env.ANNUAL_CYCLE_ENABLED !== 'false';
}
