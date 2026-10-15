import { BadRequestException } from '@nestjs/common';
import { CashRoundingType, Prisma } from '@prisma/client';
import { postMovement, toReais } from './cash-ledger';

type Tx = Prisma.TransactionClient;

/** A forma na tela do caixa (FC-9): dinheiro, PIX ou cartão. */
export type CashMethod = 'CASH' | 'PIX' | 'CARD';

/** Uma parte do recebimento, em centavos. */
export type ReceiptPart = {
  method: CashMethod;
  paymentConditionId: string;
  bankAccountId?: string | null;
  amount: number;
};

/**
 * O limite do arredondamento no balcão para a venda (FC-18): em valor
 * (centavos) ou em percentual do total (centésimos de ponto).
 */
export const roundingOf = (
  front: { roundingType: CashRoundingType; roundingLimit: number },
  total: number,
) =>
  front.roundingType === 'PERCENT'
    ? Math.floor((Math.max(0, total) * front.roundingLimit) / 10000)
    : front.roundingLimit;

/** A forma da configuração da venda rápida (dinheiro, pix, cartao). */
export const METHOD_SETTING: Record<CashMethod, string> = {
  CASH: 'dinheiro',
  PIX: 'pix',
  CARD: 'cartao',
};

export const METHOD_LABEL: Record<CashMethod, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CARD: 'Cartão',
};

/**
 * A conta de cada parte (CX-2): a escolhida, se for da empresa e estiver
 * ativa; senão a da frente de caixa para aquela forma (cada frente pode ter
 * a sua) e, por fim, a padrão da forma. PIX e cartão precisam de conta: é
 * para ela que o valor vai; o dinheiro da frente de caixa fica na gaveta até
 * o fechamento.
 */
export async function resolveParts(
  tx: Tx,
  companyId: string,
  parts: ReceiptPart[],
  options: {
    cashNeedsAccount: boolean;
    frontAccounts?: Partial<Record<CashMethod, string | null>>;
  },
): Promise<ReceiptPart[]> {
  const conditionIds = [...new Set(parts.map((p) => p.paymentConditionId))];
  const conditions = await tx.paymentCondition.findMany({
    where: { id: { in: conditionIds }, companyId },
    select: { id: true },
  });
  if (conditions.length !== conditionIds.length) {
    throw new BadRequestException('Forma de pagamento não encontrada');
  }
  const resolved: ReceiptPart[] = [];
  for (const part of parts) {
    let bankAccountId: string | null = null;
    if (part.bankAccountId) {
      const chosen = await tx.bankAccount.findFirst({
        where: { id: part.bankAccountId, companyId, isActive: true },
        select: { id: true },
      });
      if (!chosen) throw new BadRequestException('Conta não encontrada');
      bankAccountId = chosen.id;
    }
    // A conta da frente para a forma; inativa, vale a padrão
    const frontAccount = options.frontAccounts?.[part.method];
    if (!bankAccountId && frontAccount) {
      const front = await tx.bankAccount.findFirst({
        where: { id: frontAccount, companyId, isActive: true },
        select: { id: true },
      });
      bankAccountId = front?.id ?? null;
    }
    if (!bankAccountId && !part.bankAccountId) {
      const rule = await tx.bankAccountCashControl.findFirst({
        where: {
          paymentConditionId: part.paymentConditionId,
          isDefault: true,
          bankAccount: { companyId, isActive: true },
        },
        select: { bankAccountId: true },
      });
      bankAccountId = rule?.bankAccountId ?? null;
    }
    if (
      !bankAccountId &&
      (part.method !== 'CASH' || options.cashNeedsAccount)
    ) {
      throw new BadRequestException(
        `Escolha a conta do ${METHOD_LABEL[part.method]}: nenhuma conta é a padrão dessa forma em Contas bancárias`,
      );
    }
    resolved.push({ ...part, bankAccountId });
  }
  return resolved;
}

/**
 * Registra o recebimento da venda no a receber: um título por venda, com uma
 * parcela por parte recebida e a parcela do que falta, que encolhe a cada
 * recebimento. Assim a venda do balcão aparece no Fluxo e nos relatórios
 * pelo recebido.
 *
 * - `drawer` (frente de caixa): a parte fica paga, sem lançar na conta; o
 *   dinheiro chega às contas no fechamento da sessão, um movimento por forma.
 * - `direct` (cobrar na hora): o dinheiro entra realizado na conta padrão;
 *   PIX e cartão ficam provisionados na conta padrão da forma (FC-10).
 *
 * As partes já vêm com a conta (`resolveParts`).
 */
export async function recordSaleReceipt(
  tx: Tx,
  input: {
    companyId: string;
    quotationId: string;
    clientId: string | null;
    reference: string;
    /** O valor da venda, em centavos, já com o desconto do balcão */
    total: number;
    parts: ReceiptPart[];
    mode: 'drawer' | 'direct';
    date: Date;
    actor: { id: string | null; name: string };
    natureId?: string | null;
    subCategoryId?: string | null;
  },
) {
  let receivable = await tx.receivable.findFirst({
    where: {
      quotationId: input.quotationId,
      financialType: 'MAIN',
      status: { not: 'CANCELED' },
    },
    select: { id: true },
  });
  if (!receivable) {
    receivable = await tx.receivable.create({
      data: {
        companyId: input.companyId,
        clientId: input.clientId,
        quotationId: input.quotationId,
        description: `Venda ${input.reference}`,
        reference: input.reference,
        referenceDate: input.date,
        totalAmount: toReais(input.total),
        totalValue: toReais(input.total),
        installmentQty: 0,
        natureId: input.natureId ?? null,
        subCategoryId: input.subCategoryId ?? null,
      },
      select: { id: true },
    });
  } else {
    await tx.receivable.update({
      where: { id: receivable.id },
      data: {
        totalAmount: toReais(input.total),
        totalValue: toReais(input.total),
      },
    });
  }
  const existing = await tx.receivableInstallment.findMany({
    where: { receivableId: receivable.id },
    select: { id: true, status: true, installmentNumber: true },
  });
  let number = Math.max(0, ...existing.map((row) => row.installmentNumber));
  for (const part of input.parts) {
    const provisioned = input.mode === 'direct' && part.method !== 'CASH';
    const installment = await tx.receivableInstallment.create({
      data: {
        receivableId: receivable.id,
        installmentNumber: ++number,
        dueDate: input.date,
        amount: toReais(part.amount),
        paidAmount: toReais(part.amount),
        paymentConditionId: part.paymentConditionId,
        bankAccountId: part.bankAccountId ?? null,
        status: provisioned ? 'PROVISIONED' : 'PAID',
        ...(provisioned
          ? { provisionDate: input.date }
          : { paidDate: input.date }),
      },
      select: { id: true },
    });
    // Cobrar na hora: o dinheiro já está na conta Caixa
    if (input.mode === 'direct' && part.method === 'CASH') {
      await postMovement(tx, {
        bankAccountId: part.bankAccountId as string,
        type: 'INCOME',
        amount: toReais(part.amount),
        description: `Venda ${input.reference} · Dinheiro`,
        date: input.date,
        paymentConditionId: part.paymentConditionId,
        responsible: input.actor,
        natureId: input.natureId ?? null,
        subCategoryId: input.subCategoryId ?? null,
        receivableInstallmentId: installment.id,
      });
    }
  }
  // O que falta receber fica numa parcela só, que encolhe a cada recebimento
  const received = await tx.receivableInstallment.aggregate({
    where: {
      receivableId: receivable.id,
      status: { in: ['PAID', 'PROVISIONED'] },
    },
    _sum: { amount: true },
  });
  const remaining = Math.max(
    0,
    input.total - Math.round((received._sum.amount ?? 0) * 100),
  );
  const pending = existing.find((row) => row.status === 'PENDING');
  if (remaining > 0) {
    if (pending) {
      await tx.receivableInstallment.update({
        where: { id: pending.id },
        data: { amount: toReais(remaining) },
      });
    } else {
      await tx.receivableInstallment.create({
        data: {
          receivableId: receivable.id,
          installmentNumber: ++number,
          dueDate: input.date,
          amount: toReais(remaining),
          status: 'PENDING',
        },
      });
    }
  } else if (pending) {
    await tx.receivableInstallment.delete({ where: { id: pending.id } });
  }
  const count = await tx.receivableInstallment.count({
    where: { receivableId: receivable.id },
  });
  await tx.receivable.update({
    where: { id: receivable.id },
    data: {
      installmentQty: count,
      status: remaining > 0 ? 'PENDING' : 'PAID',
    },
  });
  return receivable.id;
}
