import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  CashActor,
  MissingCashDay,
  actorOfUser,
  workdayEndOf,
  brDay,
  dayOf,
  dayRange,
  postMovement,
  signedCents,
  toCents,
  toReais,
} from './cash-ledger';
import {
  CashAdjustmentDto,
  CashDayCloseDto,
  CashDayFilterDto,
  CashDayOpenDto,
  CashDayReopenDto,
  CashTransferDto,
} from './dto/cash-day.dto';

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const DAY_NOT_FOUND = 'Caixa não encontrado';
const ACCOUNT_NOT_FOUND = 'Conta não encontrada';

export type { CashActor };

const MOVEMENT_SELECT = {
  id: true,
  type: true,
  kind: true,
  amount: true,
  description: true,
  transactionDate: true,
  operationDate: true,
  retroactive: true,
  awaitingApproval: true,
  approvedByName: true,
  responsibleName: true,
  reason: true,
  natureId: true,
  subCategoryId: true,
  linkedId: true,
  paymentConditionId: true,
  receivableInstallment: {
    select: { paymentCondition: { select: { name: true } } },
    take: 1,
  },
  payableInstallment: {
    select: { paymentCondition: { select: { name: true } } },
    take: 1,
  },
} satisfies Prisma.TransactionSelect;

const DAY_SELECT = {
  id: true,
  number: true,
  bankAccountId: true,
  openingDate: true,
  status: true,
  openingBalance: true,
  openedByName: true,
  createdAt: true,
  closedByName: true,
  closingDate: true,
  informed: true,
  notes: true,
  reopenings: true,
  transactions: {
    select: MOVEMENT_SELECT,
    orderBy: { transactionDate: 'asc' },
  },
} satisfies Prisma.CashRegisterSelect;

type DayRow = Prisma.CashRegisterGetPayload<{ select: typeof DAY_SELECT }>;
type MovementRow = DayRow['transactions'][number];

/** O tipo do movimento na tela: o especial, ou o sentido. */
const kindOf = (row: MovementRow) =>
  row.kind ??
  ({
    INCOME: 'INCOME',
    OUTCOME: 'EXPENSE',
    TRANSFER_INCOME: 'TRANSFER_IN',
    TRANSFER_OUTCOME: 'TRANSFER_OUT',
  }[row.type] as string);

export const movementView = (
  row: MovementRow,
  names: Map<string, string> = new Map(),
) => ({
  id: row.id,
  kind: kindOf(row),
  description: row.description ?? '',
  amount: signedCents(row),
  method:
    row.receivableInstallment[0]?.paymentCondition?.name ??
    row.payableInstallment[0]?.paymentCondition?.name ??
    (row.paymentConditionId ? names.get(row.paymentConditionId) : null) ??
    '',
  operationDate: dayOf(row.operationDate ?? row.transactionDate),
  // Só o que aguarda aprovação ainda não compensou (o provisionado fica na
  // parcela e vem à parte)
  settled: !row.awaitingApproval,
  retroactive: row.retroactive,
  reason: row.reason ?? undefined,
  natureId: row.natureId,
  categoryId: row.subCategoryId,
  category: row.subCategoryId ? names.get(row.subCategoryId) : undefined,
  responsible: row.responsibleName ?? '',
  linkedId: row.linkedId ?? undefined,
  awaitingApproval: row.awaitingApproval,
  approvedBy: row.approvedByName ?? undefined,
});

type Movement = ReturnType<typeof movementView> | ProvisionMovement;
type ProvisionMovement = Omit<ReturnType<typeof movementView>, 'settled'> & {
  settled: false;
};

/** Os totais do dia (CX-2): só o compensado mexe no saldo. */
export const dayTotals = (opening: number, movements: Movement[]) => {
  const settled = movements.filter((item) => item.settled);
  const current = settled.filter((item) => !item.retroactive);
  const entries = current
    .filter((item) => item.amount > 0)
    .reduce((sum, item) => sum + item.amount, 0);
  const exits = current
    .filter((item) => item.amount < 0)
    .reduce((sum, item) => sum - item.amount, 0);
  const retroactive = settled
    .filter((item) => item.retroactive)
    .reduce((sum, item) => sum + item.amount, 0);
  return {
    entries,
    exits,
    retroactive,
    balance: opening + entries - exits + retroactive,
    pending: movements
      .filter((item) => !item.settled)
      .reduce((sum, item) => sum + item.amount, 0),
  };
};

/**
 * O caixa do dia de cada conta com controle (CX-2, CX-3, CX-4, FC-14,
 * ALT-7): abrir, ajustar, transferir em par, fechar com a contagem e a
 * quebra, reabrir com motivo e aprovar o que chegou da frente de caixa. Um
 * caixa é uma conta num dia; os valores na API vão em centavos.
 */
@Injectable()
export class CashDayService {
  constructor(private readonly prisma: PrismaService) {}

  /** Quem age: o colaborador da empresa, ou o usuário. */
  actorOf(user: { userId?: string; companyId: string }) {
    return actorOfUser(this.prisma, user);
  }

  /* ------------------------------------------------------------ leitura */

  private async names(companyId: string, ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return new Map<string, string>();
    const [conditions, categories] = await Promise.all([
      this.prisma.paymentCondition.findMany({
        where: { id: { in: wanted }, companyId },
        select: { id: true, name: true },
      }),
      this.prisma.subCategory.findMany({
        where: { id: { in: wanted }, companyId },
        select: { id: true, description: true },
      }),
    ]);
    return new Map<string, string>([
      ...conditions.map((row) => [row.id, row.name] as [string, string]),
      ...categories.map(
        (row) => [row.id, row.description ?? ''] as [string, string],
      ),
    ]);
  }

  /** O provisionado da conta no dia: previsão, fora do saldo. */
  private async provisions(bankAccountId: string, day: string) {
    const range = dayRange(day);
    const [incomes, payments] = await Promise.all([
      this.prisma.receivableInstallment.findMany({
        where: { bankAccountId, status: 'PROVISIONED', provisionDate: range },
        select: {
          id: true,
          paidAmount: true,
          amount: true,
          provisionDate: true,
          paymentCondition: { select: { name: true } },
          receivable: { select: { description: true } },
        },
      }),
      this.prisma.payableInstallment.findMany({
        where: { bankAccountId, status: 'PROVISIONED', provisionDate: range },
        select: {
          id: true,
          paidAmount: true,
          amount: true,
          provisionDate: true,
          paymentCondition: { select: { name: true } },
          payable: { select: { description: true } },
        },
      }),
    ]);
    const view = (
      id: string,
      sign: 1 | -1,
      reais: number,
      date: Date,
      method: string,
      description: string,
      kind: 'INCOME' | 'EXPENSE',
    ): ProvisionMovement => ({
      id: `prov:${id}`,
      kind,
      description,
      amount: sign * (toCents(reais) ?? 0),
      method,
      operationDate: dayOf(date),
      settled: false,
      retroactive: false,
      reason: undefined,
      natureId: null,
      categoryId: null,
      category: undefined,
      responsible: '',
      linkedId: undefined,
      awaitingApproval: false,
      approvedBy: undefined,
    });
    return [
      ...incomes.map((row) =>
        view(
          row.id,
          1,
          row.paidAmount || row.amount,
          row.provisionDate!,
          row.paymentCondition?.name ?? '',
          row.receivable?.description ?? 'Recebimento provisionado',
          'INCOME',
        ),
      ),
      ...payments.map((row) =>
        view(
          row.id,
          -1,
          row.paidAmount || row.amount,
          row.provisionDate!,
          row.paymentCondition?.name ?? '',
          row.payable?.description ?? 'Pagamento provisionado',
          'EXPENSE',
        ),
      ),
    ];
  }

  private async dayView(companyId: string, row: DayRow) {
    const names = await this.names(companyId, [
      ...row.transactions.map((item) => item.paymentConditionId),
      ...row.transactions.map((item) => item.subCategoryId),
    ]);
    const day = dayOf(row.openingDate);
    const movements: Movement[] = [
      ...row.transactions.map((item) => movementView(item, names)),
      ...(await this.provisions(row.bankAccountId, day)),
    ];
    const opening = toCents(row.openingBalance) ?? 0;
    return {
      id: row.id,
      number: row.number ?? 0,
      bankAccountId: row.bankAccountId,
      accountId: row.bankAccountId,
      date: day,
      status: row.status,
      opening,
      openedBy: row.openedByName ?? '',
      openedAt: row.createdAt.toISOString(),
      closedBy: row.closedByName ?? undefined,
      closedAt: row.closingDate?.toISOString(),
      informed: toCents(row.informed) ?? undefined,
      note: row.notes ?? undefined,
      reopenings: (row.reopenings as unknown[]) ?? [],
      // Sem nenhum lançamento: não trava o dia seguinte (vira o caixa dele)
      untouched: !row.transactions.length,
      totals: dayTotals(opening, movements),
      movements,
    };
  }

  /** O saldo do caixa, em centavos (o compensado). */
  private async balanceOfDay(cashRegisterId: string) {
    const row = await this.prisma.cashRegister.findUnique({
      where: { id: cashRegisterId },
      select: DAY_SELECT,
    });
    const movements = row!.transactions.map((item) => movementView(item));
    return dayTotals(toCents(row!.openingBalance) ?? 0, movements).balance;
  }

  /**
   * O saldo da conta (CX-2): com controle, o do último caixa do dia; sem
   * caixa, o saldo inicial. Sem controle, o inicial mais os lançamentos.
   */
  async accountBalance(account: {
    id: string;
    cashControl: boolean;
    kind: string;
    openingBalance: number;
    openingDate: Date | null;
  }) {
    if (account.cashControl && account.kind !== 'CARD') {
      const last = await this.prisma.cashRegister.findFirst({
        where: { bankAccountId: account.id },
        orderBy: { openingDate: 'desc' },
        select: { id: true },
      });
      return last
        ? this.balanceOfDay(last.id)
        : (toCents(account.openingBalance) ?? 0);
    }
    const rows = await this.prisma.transaction.findMany({
      where: {
        bankAccountId: account.id,
        awaitingApproval: false,
        ...(account.openingDate
          ? { transactionDate: { gte: account.openingDate } }
          : {}),
      },
      select: { type: true, amount: true },
    });
    return (
      (toCents(account.openingBalance) ?? 0) +
      rows.reduce((sum, row) => sum + signedCents(row), 0)
    );
  }

  /** A tela do controle de caixa: a linha de hoje de cada conta e os dias. */
  async list(companyId: string, filter: CashDayFilterDto, values: boolean) {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 10));
    const today = dayOf(new Date());
    const where: Prisma.CashRegisterWhereInput = {
      companyId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.bankAccountId ? { bankAccountId: filter.bankAccountId } : {}),
    };
    const [total, rows, accounts] = await Promise.all([
      this.prisma.cashRegister.count({ where }),
      this.prisma.cashRegister.findMany({
        where,
        orderBy: [
          { openingDate: filter.sort === 'asc' ? 'asc' : 'desc' },
          { number: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        select: DAY_SELECT,
      }),
      this.prisma.bankAccount.findMany({
        where: { companyId, isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          kind: true,
          cashControl: true,
          openingBalance: true,
          openingDate: true,
          cashRegister: {
            where: { status: 'OPEN' },
            orderBy: { openingDate: 'asc' },
            select: {
              id: true,
              openingDate: true,
              status: true,
              transactions: {
                where: { awaitingApproval: true },
                select: { id: true },
              },
              _count: { select: { transactions: true } },
            },
          },
        },
      }),
    ]);
    const todayRows = await this.prisma.cashRegister.findMany({
      where: { companyId, openingDate: dayRange(today) },
      select: { id: true, status: true, bankAccountId: true },
    });
    return {
      today,
      // O aviso antes do bloqueio do dia seguinte (CX-3)
      workdayEnd: await workdayEndOf(this.prisma, companyId),
      accounts: await Promise.all(
        accounts.map(async (account) => {
          const stuck = account.cashRegister.find(
            (register) =>
              dayOf(register.openingDate) < today &&
              register._count.transactions > 0,
          );
          const todayDay = todayRows.find(
            (register) => register.bankAccountId === account.id,
          );
          return {
            id: account.id,
            name: account.name,
            kind: account.kind,
            cashControl: account.cashControl,
            ...(values ? { balance: await this.accountBalance(account) } : {}),
            todayDay: todayDay
              ? { id: todayDay.id, status: todayDay.status }
              : null,
            stuckDay: stuck
              ? {
                  id: stuck.id,
                  date: dayOf(stuck.openingDate),
                  awaitingApproval: stuck.transactions.length,
                }
              : null,
          };
        }),
      ),
      days: await Promise.all(rows.map((row) => this.dayView(companyId, row))),
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
      total,
    };
  }

  private async day(companyId: string, id: string) {
    const row = await this.prisma.cashRegister.findFirst({
      where: { id, companyId },
      select: {
        ...DAY_SELECT,
        bankAccount: {
          select: {
            id: true,
            name: true,
            kind: true,
            cashControl: true,
            shortageTolerance: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException(DAY_NOT_FOUND);
    return row;
  }

  async detail(companyId: string, id: string) {
    return this.dayView(companyId, await this.day(companyId, id));
  }

  /* -------------------------------------------------------- mudanças */

  /** Abre o caixa da conta num dia (FC-14: dia anterior aberto trava). */
  async open(companyId: string, dto: CashDayOpenDto, actor: CashActor) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, companyId, isActive: true },
      select: {
        id: true,
        cashControl: true,
        kind: true,
        openingBalance: true,
      },
    });
    if (!account) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    if (!account.cashControl || account.kind === 'CARD') {
      bad('Esta conta está sem controle de caixa: não tem abertura');
    }
    const day = dto.date ?? dayOf(new Date());
    const range = dayRange(day);
    const [sameDay, stuck, later] = await Promise.all([
      this.prisma.cashRegister.count({
        where: { bankAccountId: account.id, openingDate: range },
      }),
      this.prisma.cashRegister.findFirst({
        where: {
          bankAccountId: account.id,
          status: 'OPEN',
          openingDate: { lt: range.gte },
        },
        orderBy: { openingDate: 'asc' },
        select: {
          id: true,
          openingDate: true,
          _count: { select: { transactions: true } },
        },
      }),
      this.prisma.cashRegister.count({
        where: { bankAccountId: account.id, openingDate: { gt: range.lte } },
      }),
    ]);
    if (sameDay)
      throw new ConflictException('Esta conta já tem caixa nesse dia');
    // O caixa aberto que nunca recebeu lançamento (o que o cadastro da
    // empresa abre) não trava o dia: ele passa a ser o caixa pedido
    const untouched = stuck && !stuck._count.transactions ? stuck : null;
    if (stuck && !untouched) {
      throw new ConflictException(
        `O caixa de ${brDay(dayOf(stuck.openingDate))} desta conta ainda está aberto. Feche-o antes de abrir outro dia`,
      );
    }
    if (later) {
      throw new ConflictException(
        'Esta conta já tem caixa depois desse dia: a abertura dele mudaria',
      );
    }
    // A abertura é o saldo do caixa anterior da mesma conta (CX-3)
    const previous = await this.prisma.cashRegister.findFirst({
      where: {
        bankAccountId: account.id,
        openingDate: { lt: range.gte },
        ...(untouched ? { id: { not: untouched.id } } : {}),
      },
      orderBy: { openingDate: 'desc' },
      select: { id: true },
    });
    const opening = previous
      ? await this.balanceOfDay(previous.id)
      : (toCents(account.openingBalance) ?? 0);
    if (untouched) {
      await this.prisma.cashRegister.update({
        where: { id: untouched.id },
        data: {
          openingDate: new Date(range.gte.getTime() + 12 * 3600000),
          openingBalance: toReais(opening),
          openedById: actor.id,
          openedByName: actor.name,
        },
      });
      return this.detail(companyId, untouched.id);
    }
    const last = await this.prisma.cashRegister.aggregate({
      where: { companyId },
      _max: { number: true },
    });
    const created = await this.prisma.cashRegister.create({
      data: {
        companyId,
        bankAccountId: account.id,
        // O meio do dia no fuso da empresa: a data não escorrega
        openingDate: new Date(range.gte.getTime() + 12 * 3600000),
        openingBalance: toReais(opening),
        status: 'OPEN',
        number: (last._max.number ?? 0) + 1,
        openedById: actor.id,
        openedByName: actor.name,
      },
      select: { id: true },
    });
    return this.detail(companyId, created.id);
  }

  /** Ajuste de entrada ou saída, com motivo e plano de contas (CX-3, CX-5). */
  async adjust(
    companyId: string,
    id: string,
    dto: CashAdjustmentDto,
    actor: CashActor,
  ) {
    const day = await this.day(companyId, id);
    if (day.status !== 'OPEN') {
      bad('Este caixa está fechado e não permite lançamento');
    }
    if (!dto.amount) bad('Informe o valor do ajuste');
    const reason = dto.reason?.trim() || bad('Informe o motivo do ajuste');
    if (!dto.natureId || !dto.categoryId) {
      bad('Informe o plano de contas do ajuste');
    }
    const category = await this.prisma.subCategory.findFirst({
      where: { id: dto.categoryId, natureId: dto.natureId, companyId },
      select: { id: true },
    });
    if (!category) bad('Informe o plano de contas do ajuste');
    const created = await this.prisma.$transaction(async (tx) => {
      const amount = Math.abs(toReais(dto.amount));
      const row = await tx.transaction.create({
        data: {
          type: dto.amount > 0 ? 'INCOME' : 'OUTCOME',
          kind: 'ADJUSTMENT',
          amount,
          description: dto.amount > 0 ? 'Ajuste de entrada' : 'Ajuste de saída',
          reason,
          natureId: dto.natureId,
          subCategoryId: dto.categoryId,
          responsibleId: actor.id,
          responsibleName: actor.name,
          cashRegisterId: day.id,
          bankAccountId: day.bankAccountId,
          operationDate: day.openingDate,
        },
        select: MOVEMENT_SELECT,
      });
      await tx.cashRegister.update({
        where: { id: day.id },
        data:
          dto.amount > 0
            ? { totalIncomes: { increment: amount } }
            : { totalOutcomes: { increment: amount } },
      });
      return row;
    });
    return movementView(
      created,
      await this.names(companyId, [dto.categoryId!]),
    );
  }

  /**
   * Fecha o dia com o informado (CX-3, 4.1): na gaveta, a diferença fora
   * da tolerância vira quebra no nome de quem fecha; no banco, só exige a
   * explicação. A operadora de cartão não fecha.
   */
  async close(
    companyId: string,
    id: string,
    dto: CashDayCloseDto,
    actor: CashActor,
  ) {
    const day = await this.day(companyId, id);
    if (day.status !== 'OPEN') bad('Este caixa já está fechado');
    const account = day.bankAccount;
    if (account.kind === 'CARD') {
      bad('A conta da operadora de cartão não fecha o dia');
    }
    if (day.transactions.some((item) => item.awaitingApproval)) {
      bad('Aprove os valores que chegaram da frente de caixa antes de fechar');
    }
    const note = dto.note?.trim() ?? '';
    const expected = await this.balanceOfDay(day.id);
    const difference = dto.informed - expected;
    if (account.kind === 'CASH' && (dto.informed < 0 || expected < 0)) {
      bad(
        'O caixa físico não fecha com saldo negativo: confira os lançamentos',
      );
    }
    let posted = false;
    if (difference !== 0) {
      if (account.kind === 'BANK' && !note) {
        bad('O extrato não bate com o sistema: explique a diferença');
      }
      if (account.kind === 'CASH') {
        const tolerance = toCents(account.shortageTolerance);
        const within = tolerance !== null && Math.abs(difference) <= tolerance;
        if (!within && !note) bad('A contagem não bate: explique a diferença');
        posted = !within;
      }
    }
    await this.prisma.$transaction(async (tx) => {
      if (posted) {
        const amount = Math.abs(toReais(difference));
        await tx.transaction.create({
          data: {
            type: difference < 0 ? 'OUTCOME' : 'INCOME',
            kind: difference < 0 ? 'SHORTAGE' : 'OVERAGE',
            amount,
            description: 'Diferença da contagem',
            reason: note,
            responsibleId: actor.id,
            responsibleName: actor.name,
            cashRegisterId: day.id,
            bankAccountId: day.bankAccountId,
            operationDate: day.openingDate,
          },
        });
        await tx.cashRegister.update({
          where: { id: day.id },
          data:
            difference < 0
              ? { totalOutcomes: { increment: amount } }
              : { totalIncomes: { increment: amount } },
        });
      }
      await tx.cashRegister.update({
        where: { id: day.id },
        data: {
          status: 'CLOSED',
          closingDate: new Date(),
          closedById: actor.id,
          closedByName: actor.name,
          informed: toReais(dto.informed),
          notes: note || null,
          // O saldo do sistema depois da quebra: a abertura do próximo dia
          closingBalance: toReais(expected + (posted ? difference : 0)),
        },
      });
    });
    return { expected, informed: dto.informed, difference, posted };
  }

  /**
   * Reabre o caixa fechado com motivo (CX-3, ALT-7): a quebra apurada sai,
   * o informado se apaga e a reabertura fica registrada. Com caixa depois
   * dele na conta, recusa: a abertura encadeada mudaria.
   */
  async reopen(
    companyId: string,
    id: string,
    dto: CashDayReopenDto,
    actor: CashActor,
  ) {
    const day = await this.day(companyId, id);
    if (day.status !== 'CLOSED') bad('Só se reabre um caixa fechado');
    const reason =
      dto.reason?.trim() || bad('Informe por que o caixa está sendo reaberto');
    const later = await this.prisma.cashRegister.count({
      where: {
        bankAccountId: day.bankAccountId,
        openingDate: { gt: dayRange(dayOf(day.openingDate)).lte },
      },
    });
    if (later) {
      throw new ConflictException(
        'Esta conta já tem caixa depois deste dia: reabrir mudaria a abertura dele',
      );
    }
    const breaks = day.transactions.filter(
      (item) => item.kind === 'SHORTAGE' || item.kind === 'OVERAGE',
    );
    await this.prisma.$transaction(async (tx) => {
      for (const item of breaks) {
        await tx.transaction.delete({ where: { id: item.id } });
        await tx.cashRegister.update({
          where: { id: day.id },
          data:
            item.type === 'INCOME'
              ? { totalIncomes: { decrement: item.amount } }
              : { totalOutcomes: { decrement: item.amount } },
        });
      }
      await tx.cashRegister.update({
        where: { id: day.id },
        data: {
          status: 'OPEN',
          informed: null,
          closingBalance: null,
          closingDate: null,
          closedById: null,
          closedByName: null,
          reopenings: [
            ...((day.reopenings as unknown[]) ?? []),
            { at: new Date().toISOString(), by: actor.name, reason },
          ] as Prisma.InputJsonValue,
        },
      });
    });
    return this.detail(companyId, id);
  }

  /** O responsável aprova o valor que chegou da frente de caixa (CX-4). */
  async approve(
    companyId: string,
    id: string,
    movementId: string,
    actor: CashActor,
  ) {
    const day = await this.day(companyId, id);
    const movement = day.transactions.find((item) => item.id === movementId);
    if (!movement) throw new NotFoundException('Lançamento não encontrado');
    if (day.status !== 'OPEN')
      bad('Este caixa está fechado: reabra para aprovar');
    if (!movement.awaitingApproval) bad('Este valor não aguarda aprovação');
    const updated = await this.prisma.transaction.update({
      where: { id: movementId },
      data: {
        awaitingApproval: false,
        approvedById: actor.id,
        approvedByName: actor.name,
        approvedAt: new Date(),
      },
      select: MOVEMENT_SELECT,
    });
    return movementView(updated);
  }

  /**
   * Transferência em par (CX-2): sai de uma conta e entra na outra, ligadas
   * pelo mesmo id; a conta sem controle recebe direto. Fora do resultado.
   */
  async transfer(companyId: string, dto: CashTransferDto, actor: CashActor) {
    if (!dto.fromId || !dto.toId) bad('Escolha a origem e o destino');
    if (dto.fromId === dto.toId)
      bad('Origem e destino precisam ser diferentes');
    if (!(dto.amount > 0)) bad('O valor precisa ser maior que zero');
    const accounts = await this.prisma.bankAccount.findMany({
      where: {
        id: { in: [dto.fromId!, dto.toId!] },
        companyId,
        isActive: true,
      },
      select: { id: true, name: true, kind: true },
    });
    const from = accounts.find((item) => item.id === dto.fromId);
    const to = accounts.find((item) => item.id === dto.toId);
    if (!from || !to) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    // A liquidação do cartão (FC-10): a operadora baixa o valor cheio, o
    // destino recebe o líquido e a diferença vai para "taxa de cartão"
    const fee = dto.fee ?? 0;
    if (fee > 0 && from.kind !== 'CARD') {
      bad('A taxa só vale na liquidação da operadora de cartão');
    }
    if (fee >= dto.amount) bad('A taxa precisa ser menor que o valor');
    const net = dto.amount - fee;
    const feeCategory = fee
      ? await this.prisma.subCategory.findFirst({
          where: {
            companyId,
            isActive: true,
            description: {
              startsWith: 'Tarifa de Cartão',
              mode: 'insensitive',
            },
          },
          select: { id: true, natureId: true },
        })
      : null;
    const date = dto.date
      ? new Date(dayRange(dto.date).gte.getTime() + 12 * 3600000)
      : new Date();
    const linkedId = randomUUID();
    const method = dto.method ? ` (${dto.method})` : '';
    try {
      const [out, into] = await this.prisma.$transaction(async (tx) => [
        await postMovement(tx, {
          bankAccountId: from.id,
          type: 'TRANSFER_OUTCOME',
          amount: toReais(net),
          description: `Transferência para ${to.name}${method}`,
          date,
          linkedId,
          responsible: actor,
        }),
        await postMovement(tx, {
          bankAccountId: to.id,
          type: 'TRANSFER_INCOME',
          amount: toReais(net),
          description: `Transferência de ${from.name}${method}`,
          date,
          linkedId,
          responsible: actor,
        }),
        ...(fee
          ? [
              await postMovement(tx, {
                bankAccountId: from.id,
                type: 'OUTCOME',
                kind: 'CARD_FEE',
                amount: toReais(fee),
                description: `Taxa de cartão · liquidação para ${to.name}`,
                date,
                linkedId,
                responsible: actor,
                natureId: feeCategory?.natureId ?? null,
                subCategoryId: feeCategory?.id ?? null,
              }),
            ]
          : []),
      ]);
      return {
        linkedId,
        out: { id: out.id, amount: -net },
        in: { id: into.id, amount: net },
        fee,
      };
    } catch (error) {
      if (error instanceof MissingCashDay) {
        bad(
          `Abra o caixa de ${error.accountName} nesse dia antes de transferir`,
        );
      }
      throw error;
    }
  }
}
