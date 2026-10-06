/**
 * Interfaces for Asaas API payloads and responses.
 * Used to eliminate `any` types in subscriptions.service.ts
 */

export interface AsaasCreateSubscriptionPayload {
  customer: string;
  billingType: string;
  value: number;
  nextDueDate: Date;
  cycle?: string;
  description?: string;
  externalReference?: string;
  callback?: {
    successUrl?: string;
  };
}

/** Cobrança parcelada: o anual em até 12x no cartão. */
export interface AsaasCreateInstallmentPayload {
  customer: string;
  billingType: string;
  /** Vencimento da primeira parcela, AAAA-MM-DD; as demais vencem mês a mês. */
  dueDate: string;
  installmentCount: number;
  /** O total; o Asaas divide pelas parcelas. */
  totalValue: number;
  description?: string;
  externalReference?: string;
  callback?: {
    successUrl?: string;
  };
}

export interface AsaasSubscriptionResponse {
  id: string;
  customer: string;
  billingType: string;
  value: number;
  nextDueDate: string;
  cycle: string;
  description: string;
  status: string;
  externalReference?: string;
}

export interface AsaasUpdateSubscriptionPayload {
  billingType?: string;
  value?: number;
  nextDueDate?: string | Date;
  cycle?: string;
  description?: string;
  status?: string;
  updatePendingPayments?: boolean;
}

/** Atualização de uma cobrança individual (não da assinatura) */
export interface AsaasUpdatePaymentPayload {
  value?: number;
  /** Formato aceito pelo Asaas: YYYY-MM-DD */
  dueDate?: string;
  description?: string;
  billingType?: string;
}

export interface AsaasPaymentResponse {
  id: string;
  status: string;
  value: number;
  dueDate: string;
  /** Id do parcelamento, quando a cobrança é parcela de um. */
  installment?: string;
  installmentNumber?: number;
  billingType?: string;
  description?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  /** Id da assinatura do Asaas a que a cobrança pertence. */
  subscription?: string;
  /**
   * Cobrança removida no Asaas. Ela continua respondendo pelo id, com o
   * `status` de antes da remoção — uma vencida removida segue "OVERDUE".
   */
  deleted?: boolean;
  confirmedDate?: string;
  paymentDate?: string;
}
