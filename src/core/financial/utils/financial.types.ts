import { Prisma, PaymentStatus } from '@prisma/client';

/**
 * Receivable com parcelas incluídas (usado em cancel/reactivate operations).
 */
export type ReceivableWithInstallments = Prisma.ReceivableGetPayload<{
  include: { installments: true };
}>;

/**
 * Payable com parcelas incluídas (usado em cancel/reactivate operations).
 */
export type PayableWithInstallments = Prisma.PayableGetPayload<{
  include: { installments: true };
}>;

/**
 * Parcela genérica (receivable ou payable) para status checks.
 */
export interface InstallmentStatusCheck {
  id: string;
  status: PaymentStatus;
  dueDate: Date;
}

/**
 * Filtro dinâmico para queries de receivables.
 */
export type ReceivableWhereInput = Prisma.ReceivableWhereInput;

/**
 * Filtro dinâmico para queries de payables.
 */
export type PayableWhereInput = Prisma.PayableWhereInput;

/**
 * Filtro dinâmico para queries de receivable installments.
 */
export type ReceivableInstallmentWhereInput =
  Prisma.ReceivableInstallmentWhereInput;

/**
 * Filtro dinâmico para queries de payable installments.
 */
export type PayableInstallmentWhereInput = Prisma.PayableInstallmentWhereInput;
