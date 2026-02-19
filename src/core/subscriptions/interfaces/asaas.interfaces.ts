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
