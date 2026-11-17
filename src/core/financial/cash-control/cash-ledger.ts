import { ForbiddenException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import {
  parseProjectDayBoundary,
  toProjectDateKey,
} from '../../fiscal/utils/project-date.util';

/**
 * O livro-caixa (CX-2, CX-3): a escala do dinheiro, o caixa em que o
 * lançamento entra e o lançamento em si. O financeiro inteiro guarda
 * CENTAVOS num campo Float: títulos, parcelas, baixas, folha, orçamento e,
 * desde 17/11/2026, também o caixa. A API do caixa do dia fala em centavos.
 *
 * Até 17/11 este arquivo partia de "as tabelas guardam reais": gravava o
 * caixa em reais e multiplicava por 100 tudo o que lia. A baixa de R$
 * 3.600,00 da folha (360000) aparecia como R$ 360.000,00 no Controle de
 * caixa, e o que o caixa gravava saía dividido por 100 nas telas antigas.
 * O `toCents` e o `toReais` ficaram só como arredondamento, para não mexer
 * em quem os chama.
 */

type Tx = Prisma.TransactionClient;

/** Quem age: o usuário da sessão (CX-2). */
export type CashActor = { id: string | null; name: string };

/** Quem age: o colaborador da empresa, ou o usuário. */
export async function actorOfUser(
  prisma: Tx,
  user: { userId?: string; companyId: string },
): Promise<CashActor> {
  if (!user.userId) return { id: null, name: 'Usuário' };
  const employee = await prisma.employee.findFirst({
    where: { userId: user.userId, companyId: user.companyId },
    select: { name: true, user: { select: { name: true } } },
  });
  const name =
    employee?.name ||
    employee?.user?.name ||
    (
      await prisma.user.findUnique({
        where: { id: user.userId },
        select: { name: true },
      })
    )?.name ||
    'Usuário';
  return { id: user.userId, name };
}

/** O valor do banco para a API: os dois em centavos; só arredonda. */
export const toCents = (stored: number | null | undefined) =>
  stored === null || stored === undefined ? null : Math.round(stored);

/** O valor da API para o banco: os dois em centavos; só arredonda. */
export const toReais = (cents: number) => Math.round(cents);

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

/**
 * Onde a baixa do a receber e do a pagar entra (CX-2, CX-3): na conta com
 * controle, no caixa do dia (ou retroativo no aberto); na conta sem controle,
 * ou sem nenhum caixa aberto, direto na conta, sem caixa. A baixa nunca é
 * recusada por falta de caixa (CX-0): o saldo da conta é calculado dos
 * lançamentos e precisa de todos eles.
 */
export async function baixaTarget(tx: Tx, bankAccountId: string, date: Date) {
  const account = await tx.bankAccount.findUnique({
    where: { id: bankAccountId },
    select: { cashControl: true, kind: true },
  });
  const controlled = !!account?.cashControl && account.kind !== 'CARD';
  const row = controlled
    ? await postingRegisterRow(tx, bankAccountId, date)
    : null;
  return (
    row ?? {
      id: null as string | null,
      bankAccountId,
      retroactive: false,
      operationDate: date,
    }
  );
}

/**
 * Estorna um lançamento (CX-2, ALT-7): nada com histórico é apagado; entra
 * o lançamento inverso, ligado ao original, como movimentação do dia (no
 * caixa aberto da conta, ou direto na conta sem controle). O que entrou num
 * caixa já fechado só o administrador estorna.
 */
export async function reverseTransaction(
  tx: Tx,
  transactionId: string,
  by: CashActor & { isAdmin?: boolean },
  reason?: string | null,
) {
  const original = await tx.transaction.findUnique({
    where: { id: transactionId },
    include: {
      cashRegister: { select: { status: true, bankAccountId: true } },
    },
  });
  if (!original) return null;
  if (original.cashRegister?.status === 'CLOSED' && !by.isAdmin) {
    throw new ForbiddenException(
      'Esta baixa entrou num caixa já fechado: só o administrador estorna',
    );
  }
  const bankAccountId =
    original.bankAccountId ?? original.cashRegister?.bankAccountId;
  if (!bankAccountId) return null;
  const now = new Date();
  const target = await baixaTarget(tx, bankAccountId, now);
  const type: TransactionType =
    original.type === 'INCOME'
      ? 'OUTCOME'
      : original.type === 'OUTCOME'
        ? 'INCOME'
        : original.type === 'TRANSFER_INCOME'
          ? 'TRANSFER_OUTCOME'
          : 'TRANSFER_INCOME';
  const reversal = await tx.transaction.create({
    data: {
      type,
      kind: 'REVERSAL',
      amount: original.amount,
      description: `Estorno · ${original.description ?? ''}`.trim(),
      reason: reason?.trim() || null,
      transactionDate: now,
      operationDate: now,
      cashRegisterId: target.id,
      bankAccountId,
      retroactive: target.retroactive,
      linkedId: original.id,
      responsibleId: by.id,
      responsibleName: by.name,
      paymentConditionId: original.paymentConditionId,
      natureId: original.natureId,
      subCategoryId: original.subCategoryId,
    },
  });
  if (target.id) {
    await tx.cashRegister.update({
      where: { id: target.id },
      data: INCOMING.includes(type)
        ? { totalIncomes: { increment: original.amount } }
        : { totalOutcomes: { increment: original.amount } },
    });
  }
  return reversal;
}

/**
 * O fim do expediente da empresa (o cadastro do expediente, padrão 18:00):
 * as telas do caixa avisam quem está com caixa aberto antes do bloqueio do
 * dia seguinte (FC-14, CX-3).
 */
export async function workdayEndOf(prisma: Tx, companyId: string) {
  const calendar = await prisma.productionCalendar.findUnique({
    where: { companyId },
    select: { endTime: true },
  });
  return calendar?.endTime ?? '18:00';
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
  /**
   * Lançamento que o sistema faz sozinho (CX-0): sem caixa aberto na conta,
   * entra direto na conta, sem caixa, em vez de recusar
   */
  withoutRegisterFallback?: boolean;
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
  if (controlled && !target && !input.withoutRegisterFallback) {
    throw new MissingCashDay(account.name);
  }

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
