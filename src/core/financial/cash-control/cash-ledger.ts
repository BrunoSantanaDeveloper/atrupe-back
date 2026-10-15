import { Prisma, TransactionType } from '@prisma/client';
import {
  parseProjectDayBoundary,
  toProjectDateKey,
} from '../../fiscal/utils/project-date.util';

/**
 * O livro-caixa (CX-2, CX-3): a escala do dinheiro, o caixa em que o
 * lançamento entra e o lançamento em si. As tabelas do caixa guardam reais
 * (Float), como o resto do financeiro; a API nova do caixa do dia fala em
 * centavos (contrato), e a conversão fica só aqui.
 */

type Tx = Prisma.TransactionClient;

/** Reais (banco) → centavos (API). */
export const toCents = (reais: number | null | undefined) =>
  reais === null || reais === undefined ? null : Math.round(reais * 100);

/** Centavos (API) → reais (banco). */
export const toReais = (cents: number) => Math.round(cents) / 100;

export const INCOMING: TransactionType[] = ['INCOME', 'TRANSFER_INCOME'];

/** O valor com sinal, em centavos: entrada positiva, saída negativa. */
export const signedCents = (row: { type: TransactionType; amount: number }) =>
  (INCOMING.includes(row.type) ? 1 : -1) * (toCents(row.amount) ?? 0);

/** O dia (YYYY-MM-DD) do instante, no fuso da operação. */
export const dayOf = (date: Date) => toProjectDateKey(date);

export const dayRange = (day: string) => ({
  gte: parseProjectDayBoundary(day, 'start')!,
  lte: parseProjectDayBoundary(day, 'end')!,
});

export const brDay = (day: string) => day.split('-').reverse().join('/');

/**
 * O caixa em que entra um lançamento com a data do fato: o caixa daquele
 * dia, se está aberto; senão o caixa aberto da conta. Se o caixa aberto é
 * de um dia depois do fato (o dia do fato fechou ou não abriu), o
 * lançamento entra como retroativo (CX-3). O caixa antigo que ficou aberto
 * vários dias segue recebendo, como sempre recebeu.
 */
export async function findPostingRegister(
  tx: Tx,
  bankAccountId: string,
  date: Date,
) {
  const day = dayOf(date);
  const sameDay = await tx.cashRegister.findFirst({
    where: { bankAccountId, openingDate: dayRange(day) },
    orderBy: { openingDate: 'desc' },
    select: { id: true, status: true, openingDate: true },
  });
  if (sameDay?.status === 'OPEN') {
    return { register: sameDay, retroactive: false };
  }
  // O caixa aberto antes do fato (o de sempre, que fica aberto vários dias)
  const before = await tx.cashRegister.findFirst({
    where: {
      bankAccountId,
      status: 'OPEN',
      openingDate: { lte: dayRange(day).lte },
    },
    orderBy: { openingDate: 'desc' },
    select: { id: true, status: true, openingDate: true },
  });
  if (before) return { register: before, retroactive: false };
  // O dia do fato fechou (ou não abriu): entra no aberto, retroativo
  const after = await tx.cashRegister.findFirst({
    where: { bankAccountId, status: 'OPEN' },
    orderBy: { openingDate: 'desc' },
    select: { id: true, status: true, openingDate: true },
  });
  return after ? { register: after, retroactive: true } : null;
}

/**
 * Para as baixas antigas (a receber, a pagar): o caixa em que entra a
 * baixa, com a conta, o retroativo e a data do fato, ou nulo.
 */
export async function postingRegisterRow(
  tx: Tx,
  bankAccountId: string,
  date: Date,
) {
  const found = await findPostingRegister(tx, bankAccountId, date);
  return found
    ? {
        id: found.register.id,
        bankAccountId,
        retroactive: found.retroactive,
        operationDate: date,
      }
    : null;
}

export type PostInput = {
  bankAccountId: string;
  type: TransactionType;
  /** Em reais, positivo: o sentido vem do type */
  amount: number;
  description: string;
  /** A data do fato */
  date: Date;
  kind?: Prisma.TransactionUncheckedCreateInput['kind'];
  reason?: string | null;
  awaitingApproval?: boolean;
  responsible?: { id: string | null; name: string } | null;
  natureId?: string | null;
  subCategoryId?: string | null;
  linkedId?: string | null;
  paymentConditionId?: string | null;
  receivableInstallmentId?: string | null;
  payableInstallmentId?: string | null;
};

export class MissingCashDay extends Error {
  constructor(public readonly accountName: string) {
    super(`Abra o caixa de ${accountName} antes de lançar`);
  }
}

/**
 * Lança na conta: com controle de caixa, no caixa do dia (ou retroativo no
 * aberto); sem controle, direto na conta, sem caixa. Mantém os contadores
 * antigos do caixa em dia, para a tela antiga.
 */
export async function postMovement(tx: Tx, input: PostInput) {
  const account = await tx.bankAccount.findUnique({
    where: { id: input.bankAccountId },
    select: { id: true, name: true, cashControl: true, kind: true },
  });
  if (!account) throw new Error('Conta não encontrada');
  const controlled = account.cashControl && account.kind !== 'CARD';
  const target = controlled
    ? await findPostingRegister(tx, account.id, input.date)
    : null;
  if (controlled && !target) throw new MissingCashDay(account.name);

  const data: Prisma.TransactionUncheckedCreateInput = {
    type: input.type,
    amount: Math.abs(input.amount),
    description: input.description,
    // A data do fato; o lançamento em si fica no createdAt
    transactionDate: input.date,
    operationDate: input.date,
    cashRegisterId: target?.register.id ?? null,
    bankAccountId: account.id,
    retroactive: !!target?.retroactive,
    kind: input.kind ?? null,
    reason: input.reason ?? null,
    awaitingApproval: !!input.awaitingApproval,
    responsibleId: input.responsible?.id ?? null,
    responsibleName: input.responsible?.name ?? null,
    natureId: input.natureId ?? null,
    subCategoryId: input.subCategoryId ?? null,
    linkedId: input.linkedId ?? null,
    paymentConditionId: input.paymentConditionId ?? null,
  };
  const created = await tx.transaction.create({
    data: {
      ...data,
      ...(input.receivableInstallmentId
        ? {
            receivableInstallment: {
              connect: { id: input.receivableInstallmentId },
            },
          }
        : {}),
      ...(input.payableInstallmentId
        ? {
            payableInstallment: { connect: { id: input.payableInstallmentId } },
          }
        : {}),
    } as Prisma.TransactionUncheckedCreateInput,
  });
  if (target) {
    await tx.cashRegister.update({
      where: { id: target.register.id },
      data: INCOMING.includes(input.type)
        ? { totalIncomes: { increment: Math.abs(input.amount) } }
        : { totalOutcomes: { increment: Math.abs(input.amount) } },
    });
  }
  return created;
}
