/**
 * Type definitions for QuotationFinancialService parameters.
 * Replaces `any` types with proper interfaces matching Prisma query shapes.
 */

/** Installment shape from quotationPayment.quotationInstallment */
export interface QuotationInstallment {
  id: string;
  value: number;
  additionalFee: number | null;
  dueDate: Date;
  paymentConditionId: string | null;
}

/** Commission shape from quotationPayment.commission */
export interface QuotationCommission {
  id: string;
  commissionValue: number | null;
  totalCommission: number | null;
  supplierId: string | null;
  transferMethod: string | null;
}

/** DeliveryInfo shape used in financial operations */
export interface QuotationDeliveryInfo {
  id: string;
  cost: number | null;
  value: number | null;
  supplierId: string | null;
  estimatedDate: Date | null;
  daysAfterApproval: number | null;
  deliveryType: string | null;
}

/** QuotationPayment shape used in financial operations */
export interface QuotationPaymentForFinancial {
  billing: string | null;
  quotationInstallment: QuotationInstallment[];
  commission: QuotationCommission | null;
  downPayment: number | null;
  downPaymentDueDate: Date | null;
  downPaymentAdditionalFee: number | null;
  description: string | null;
  downPaymentConditionId: string | null;
}

/** Quotation shape required by financial service methods */
export interface QuotationForFinancial {
  id: string;
  companyId: string;
  clientId: string;
  quotationNumber: number;
  description: string | null;
  totalValue: number;
  series: { code: string } | null;
  quotationPayment: QuotationPaymentForFinancial;
  deliveryInfo: QuotationDeliveryInfo | null;
}

/** Production stage shape from JSON productionStages field */
export interface ProductionStageJson {
  id: string;
  isActive: boolean;
  [key: string]: unknown;
}
