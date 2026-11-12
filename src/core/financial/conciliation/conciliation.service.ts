import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from 'nestjs-prisma';
import {
  CashActor,
  INCOMING,
  baixaTarget,
  dayOf,
  toReais,
} from '../cash-control/cash-ledger';
import { CashDayService } from '../cash-control/cash-day.service';
import { ModuleRef } from '@nestjs/core';
import { releaseHeldSales } from 'src/core/sale/quotation/payment-hold';
import { OfxError, businessDaysBetween, parseOfx } from './ofx';
import {
  ConciliationCreateDto,
  ConciliationFilterDto,
  ConciliationLiquidateDto,
  ConciliationMatchDto,
} from './dto/conciliation.dto';

type Tx = Prisma.TransactionClient;

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const LINE_NOT_FOUND = 'Linha do extrato não encontrada';

/** Até 3 dias úteis o casamento é automático; até 10 dias, só sugestão. */
const AUTO_DAYS = 3;
const SUGGEST_DAYS = 10;

const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
};

/** O dia (AAAA-MM-DD) da coluna DATE do extrato. */
const lineDay = (date: Date) => date.toISOString().slice(0, 10);

/** O que o sistema tem e o extrato pode casar: lançamento ou parcela prevista. */
type Candidate = {
  kind: 'transaction' | 'receivable' | 'payable';
  id: string;
  day: string;
  amount: number;
  description: string;
};

const signed = (type: TransactionType, amount: number) =>
  (INCOMING.includes(type) ? 1 : -1) * Math.round(amount * 100);

/**
 * A conciliação com o extrato (CX-6): o OFX importado não duplica (FITID);
 * cada linha casa com o lançamento do sistema pelo valor e pela data (até 3
 * dias úteis, sozinho; acima disso, sugestão); o que casou vira realizado;
 * o que sobra fica em duas listas, e a linha que só está no extrato vira
 * lançamento na própria tela. O depósito da operadora liquida o cartão, com
 * a diferença na taxa.
 */
@Injectable()
export class ConciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashDay: CashDayService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private async account(companyId: string, id: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id, companyId, isActive: true },
      select: { id: true, name: true, kind: true },
    });
    if (!account) throw new NotFoundException('Conta não encontrada');
    return account;
  }

  /** Os lançamentos e as parcelas previstas da conta já casados. */
  private async linked(bankAccountId: string) {
    const rows = await this.prisma.bankStatementLine.findMany({
      where: {
        bankAccountId,
        status: { in: ['MATCHED', 'CREATED', 'SUGGESTED'] },
      },
      select: {
        transactionId: true,
        receivableInstallmentId: true,
        payableInstallmentId: true,
      },
    });
    return new Set(
      rows.flatMap((row) =>
        [
          row.transactionId,
          row.receivableInstallmentId,
          row.payableInstallmentId,
        ].filter((id): id is string => !!id),
      ),
    );
  }

  /** O que o sistema tem na conta entre os dois dias, ainda sem casar. */
  private async candidates(
    bankAccountId: string,
    from: string,
    to: string,
  ): Promise<Candidate[]> {
    const gte = addDays(from, -SUGGEST_DAYS);
    const lte = addDays(to, SUGGEST_DAYS);
    const used = await this.linked(bankAccountId);
    const [transactions, receivables, payables] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          bankAccountId,
          awaitingApproval: false,
          OR: [
            { operationDate: { gte, lte } },
            { operationDate: null, transactionDate: { gte, lte } },
          ],
        },
        select: {
          id: true,
          type: true,
          amount: true,
          description: true,
          operationDate: true,
          transactionDate: true,
        },
      }),
      // Recebido por PIX ou cartão, previsto na conta: casar o realiza
      this.prisma.receivableInstallment.findMany({
        where: {
          bankAccountId,
          status: 'PROVISIONED',
          OR: [
            { provisionDate: { gte, lte } },
            { provisionDate: null, dueDate: { gte, lte } },
          ],
        },
        select: {
          id: true,
          amount: true,
          paidAmount: true,
          provisionDate: true,
          dueDate: true,
          receivable: { select: { description: true } },
        },
      }),
      this.prisma.payableInstallment.findMany({
        where: {
          bankAccountId,
          status: 'PROVISIONED',
          OR: [
            { provisionDate: { gte, lte } },
            { provisionDate: null, dueDate: { gte, lte } },
          ],
        },
        select: {
          id: true,
          amount: true,
          paidAmount: true,
          provisionDate: true,
          dueDate: true,
          payable: { select: { description: true } },
        },
      }),
    ]);
    return [
      ...transactions.map((row) => ({
        kind: 'transaction' as const,
        id: row.id,
        day: dayOf(row.operationDate ?? row.transactionDate),
        amount: signed(row.type, row.amount),
        description: row.description ?? '',
      })),
      ...receivables.map((row) => ({
        kind: 'receivable' as const,
        id: row.id,
        day: dayOf(row.provisionDate ?? row.dueDate),
        amount: Math.round((row.paidAmount ?? row.amount) * 100),
        description: `Previsto · ${row.receivable?.description ?? ''}`,
      })),
      ...payables.map((row) => ({
        kind: 'payable' as const,
        id: row.id,
        day: dayOf(row.provisionDate ?? row.dueDate),
        amount: -Math.round((row.paidAmount ?? row.amount) * 100),
        description: `Previsto · ${row.payable?.description ?? ''}`,
      })),
    ].filter((row) => !used.has(row.id));
  }

  /**
   * A parcela prevista que o extrato confirmou vira realizada (CX-6.4): o
   * lançamento entra na conta, no dia do extrato.
   */
  private async realize(
    tx: Tx,
    kind: 'receivable' | 'payable',
    installmentId: string,
    bankAccountId: string,
    day: string,
  ) {
    const date = new Date(`${day}T12:00:00Z`);
    const target = await baixaTarget(tx, bankAccountId, date);
    if (kind === 'receivable') {
      const installment = await tx.receivableInstallment.findUniqueOrThrow({
        where: { id: installmentId },
        select: {
          id: true,
          amount: true,
          paidAmount: true,
          installmentNumber: true,
          receivable: { select: { description: true } },
        },
      });
      const amount = installment.paidAmount ?? installment.amount;
      const created = await tx.transaction.create({
        data: {
          type: 'INCOME',
          amount,
          description: `Recebimento da parcela ${installment.installmentNumber} - ${installment.receivable?.description ?? ''}`,
          transactionDate: date,
          operationDate: date,
          bankAccountId,
          cashRegisterId: target.id,
          retroactive: target.retroactive,
        },
      });
      await tx.receivableInstallment.update({
        where: { id: installmentId },
        data: { status: 'PAID', paidDate: date, transactionId: created.id },
      });
      if (target.id) {
        await tx.cashRegister.update({
          where: { id: target.id },
          data: { totalIncomes: { increment: amount } },
        });
      }
      return created.id;
    }
    const installment = await tx.payableInstallment.findUniqueOrThrow({
      where: { id: installmentId },
      select: {
        id: true,
        amount: true,
        paidAmount: true,
        installmentNumber: true,
        payable: { select: { description: true } },
      },
    });
    const amount = installment.paidAmount ?? installment.amount;
    const created = await tx.transaction.create({
      data: {
        type: 'OUTCOME',
        amount,
        description: `Pagamento da parcela ${installment.installmentNumber} - ${installment.payable?.description ?? ''}`,
        transactionDate: date,
        operationDate: date,
        bankAccountId,
        cashRegisterId: target.id,
        retroactive: target.retroactive,
      },
    });
    await tx.payableInstallment.update({
      where: { id: installmentId },
      data: { status: 'PAID', paidDate: date, transactionId: created.id },
    });
    if (target.id) {
      await tx.cashRegister.update({
        where: { id: target.id },
        data: { totalOutcomes: { increment: amount } },
      });
    }
    return created.id;
  }

  /**
   * Importa o OFX da conta: as linhas já importadas (pelo FITID) ficam de
   * fora, e as novas casam sozinhas pelo valor e pela data.
   */
  async importOfx(
    companyId: string,
    bankAccountId: string,
    content: string,
    fileName: string | null,
    actor: CashActor,
  ) {
    const account = await this.account(companyId, bankAccountId);
    if (account.kind === 'CARD') {
      bad(
        'A operadora de cartão se concilia pelo extrato do banco: importe o extrato da conta em que o depósito cai',
      );
    }
    let statement: ReturnType<typeof parseOfx>;
    try {
      statement = parseOfx(content);
    } catch (error) {
      if (error instanceof OfxError) bad(error.message);
      throw error;
    }
    if (!statement.lines.length) bad('O extrato não tem lançamentos');
    const existing = new Set(
      (
        await this.prisma.bankStatementLine.findMany({
          where: {
            bankAccountId,
            fitId: { in: statement.lines.map((line) => line.fitId) },
          },
          select: { fitId: true },
        })
      ).map((row) => row.fitId),
    );
    const fresh = statement.lines.filter((line) => !existing.has(line.fitId));
    const importId = randomUUID();
    if (fresh.length) {
      await this.prisma.bankStatementLine.createMany({
        data: fresh.map((line) => ({
          companyId,
          bankAccountId,
          fitId: line.fitId,
          date: new Date(`${line.date}T00:00:00Z`),
          amount: line.amount,
          memo: line.memo,
          importId,
          fileName,
          importedByName: actor.name,
        })),
        skipDuplicates: true,
      });
    }
    const result = await this.autoMatch(
      companyId,
      bankAccountId,
      importId,
      actor,
    );
    return {
      imported: fresh.length,
      duplicates: statement.lines.length - fresh.length,
      ...result,
    };
  }

  /** Casa as linhas da importação: sozinho até 3 dias úteis, senão sugere. */
  private async autoMatch(
    companyId: string,
    bankAccountId: string,
    importId: string,
    actor: CashActor,
  ) {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { companyId, bankAccountId, importId, status: 'UNMATCHED' },
      orderBy: { date: 'asc' },
    });
    if (!lines.length) return { matched: 0, suggested: 0, unmatched: 0 };
    const days = lines.map((line) => lineDay(line.date));
    const pool = await this.candidates(
      bankAccountId,
      days[0],
      days[days.length - 1],
    );
    let matched = 0;
    let suggested = 0;
    for (const line of lines) {
      const day = lineDay(line.date);
      const options = pool
        .filter((candidate) => candidate.amount === line.amount)
        .map((candidate) => ({
          candidate,
          distance: Math.abs(
            (new Date(candidate.day).getTime() - new Date(day).getTime()) /
              86400000,
          ),
        }))
        .filter((option) => option.distance <= SUGGEST_DAYS)
        .sort((a, b) => a.distance - b.distance);
      const best = options[0]?.candidate;
      if (!best) continue;
      pool.splice(pool.indexOf(best), 1);
      const automatic = businessDaysBetween(best.day, day) <= AUTO_DAYS;
      await this.prisma.$transaction(async (tx) => {
        const transactionId =
          automatic && best.kind !== 'transaction'
            ? await this.realize(tx, best.kind, best.id, bankAccountId, day)
            : best.kind === 'transaction'
              ? best.id
              : null;
        await tx.bankStatementLine.update({
          where: { id: line.id },
          data: {
            status: automatic ? 'MATCHED' : 'SUGGESTED',
            transactionId,
            receivableInstallmentId:
              !automatic && best.kind === 'receivable' ? best.id : null,
            payableInstallmentId:
              !automatic && best.kind === 'payable' ? best.id : null,
            ...(automatic
              ? { matchedAt: new Date(), matchedByName: actor.name }
              : {}),
          },
        });
      });
      if (automatic) matched++;
      else suggested++;
      // O título "⚠️ Pendência" realizado pelo extrato libera a venda (PA-6)
      if (automatic && best.kind === 'receivable') {
        await releaseHeldSales(this.moduleRef, this.prisma, [best.id]);
      }
    }
    return {
      matched,
      suggested,
      unmatched: lines.length - matched - suggested,
    };
  }

  /**
   * As linhas do extrato no período e o que o sistema tem na conta sem
   * casar: as duas listas que sobram (CX-6.4).
   */
  async list(companyId: string, filter: ConciliationFilterDto) {
    const account = await this.account(companyId, filter.bankAccountId);
    const last = await this.prisma.bankStatementLine.findFirst({
      where: { bankAccountId: account.id },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    const to = filter.to ?? (last ? lineDay(last.date) : dayOf(new Date()));
    const from = filter.from ?? lineDay(addDays(to, -30));
    const lines = await this.prisma.bankStatementLine.findMany({
      where: {
        bankAccountId: account.id,
        date: {
          gte: new Date(`${from}T00:00:00Z`),
          lte: new Date(`${to}T00:00:00Z`),
        },
      },
      orderBy: [{ date: 'asc' }, { importedAt: 'asc' }],
    });
    const transactionIds = lines
      .map((line) => line.transactionId)
      .filter((id): id is string => !!id);
    const linkedRows = transactionIds.length
      ? await this.prisma.transaction.findMany({
          where: { id: { in: transactionIds } },
          select: { id: true, description: true },
        })
      : [];
    const names = new Map(linkedRows.map((row) => [row.id, row.description]));
    const pool = (await this.candidates(account.id, from, to)).filter(
      (row) => row.day >= from && row.day <= to,
    );
    return {
      account,
      from,
      to,
      lines: lines.map((line) => ({
        id: line.id,
        date: lineDay(line.date),
        amount: line.amount,
        memo: line.memo,
        status: line.status,
        transactionId: line.transactionId,
        receivableInstallmentId: line.receivableInstallmentId,
        payableInstallmentId: line.payableInstallmentId,
        matchedWith: line.transactionId
          ? (names.get(line.transactionId) ?? null)
          : null,
        matchedBy: line.matchedByName,
      })),
      // No sistema e não no extrato (CX-6.4): o que não caiu
      systemOnly: pool.sort((a, b) => a.day.localeCompare(b.day)),
    };
  }

  private async line(companyId: string, id: string) {
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id, companyId },
    });
    if (!line) throw new NotFoundException(LINE_NOT_FOUND);
    return line;
  }

  /** Confirma a sugestão: casa e, sendo parcela prevista, a realiza. */
  async confirm(companyId: string, id: string, actor: CashActor) {
    const line = await this.line(companyId, id);
    if (line.status !== 'SUGGESTED') bad('Esta linha não tem sugestão');
    await this.prisma.$transaction(async (tx) => {
      const kind = line.receivableInstallmentId
        ? 'receivable'
        : line.payableInstallmentId
          ? 'payable'
          : null;
      const transactionId = kind
        ? await this.realize(
            tx,
            kind,
            (line.receivableInstallmentId ?? line.payableInstallmentId)!,
            line.bankAccountId,
            lineDay(line.date),
          )
        : line.transactionId;
      await tx.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: 'MATCHED',
          transactionId,
          receivableInstallmentId: null,
          payableInstallmentId: null,
          matchedAt: new Date(),
          matchedByName: actor.name,
        },
      });
    });
    if (line.receivableInstallmentId) {
      await releaseHeldSales(this.moduleRef, this.prisma, [
        line.receivableInstallmentId,
      ]);
    }
    return this.lineView(id);
  }

  /** Casa à mão com um lançamento ou uma parcela prevista da conta. */
  async match(
    companyId: string,
    id: string,
    dto: ConciliationMatchDto,
    actor: CashActor,
  ) {
    const line = await this.line(companyId, id);
    if (line.status === 'MATCHED' || line.status === 'CREATED') {
      bad('Esta linha já está conciliada');
    }
    const day = lineDay(line.date);
    // À mão vale qualquer lançamento sem casar da conta em dois meses
    const pool = await this.candidates(
      line.bankAccountId,
      lineDay(addDays(day, -60)),
      lineDay(addDays(day, 60)),
    );
    const target = pool.find((row) => row.id === dto.targetId);
    if (!target) bad('Lançamento não encontrado ou já conciliado');
    if (target.amount !== line.amount) {
      bad('O valor do lançamento não bate com o do extrato');
    }
    await this.prisma.$transaction(async (tx) => {
      const transactionId =
        target.kind === 'transaction'
          ? target.id
          : await this.realize(
              tx,
              target.kind,
              target.id,
              line.bankAccountId,
              day,
            );
      await tx.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: 'MATCHED',
          transactionId,
          receivableInstallmentId: null,
          payableInstallmentId: null,
          matchedAt: new Date(),
          matchedByName: actor.name,
        },
      });
    });
    if (target.kind === 'receivable') {
      await releaseHeldSales(this.moduleRef, this.prisma, [target.id]);
    }
    return this.lineView(id);
  }

  /** Desfaz o casamento (o lançamento realizado fica). */
  async unmatch(companyId: string, id: string) {
    const line = await this.line(companyId, id);
    if (!['MATCHED', 'SUGGESTED', 'IGNORED'].includes(line.status)) {
      bad('Esta linha não está casada');
    }
    await this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: 'UNMATCHED',
        transactionId: null,
        receivableInstallmentId: null,
        payableInstallmentId: null,
        matchedAt: null,
        matchedByName: null,
      },
    });
    return this.lineView(id);
  }

  /** A linha que não é lançamento (transferência entre contas já lançada…). */
  async ignore(companyId: string, id: string, actor: CashActor) {
    const line = await this.line(companyId, id);
    if (line.status !== 'UNMATCHED') bad('Só a linha sobrando é ignorada');
    await this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: 'IGNORED',
        matchedAt: new Date(),
        matchedByName: actor.name,
      },
    });
    return this.lineView(id);
  }

  /**
   * A linha do extrato que não está no sistema (tarifa, lançamento
   * esquecido) vira lançamento com valor, data e conta preenchidos; o
   * usuário completa o plano de contas (CX-6.6, CX-5).
   */
  async create(
    companyId: string,
    id: string,
    dto: ConciliationCreateDto,
    actor: CashActor,
  ) {
    const line = await this.line(companyId, id);
    if (line.status !== 'UNMATCHED') bad('Esta linha já está conciliada');
    const category = await this.prisma.subCategory.findFirst({
      where: { id: dto.categoryId, companyId, natureId: dto.natureId },
      select: { id: true, natureId: true },
    });
    if (!category) bad('Informe o plano de contas do lançamento');
    const day = lineDay(line.date);
    const date = new Date(`${day}T12:00:00Z`);
    await this.prisma.$transaction(async (tx) => {
      const target = await baixaTarget(tx, line.bankAccountId, date);
      const type: TransactionType = line.amount > 0 ? 'INCOME' : 'OUTCOME';
      const amount = toReais(Math.abs(line.amount));
      const created = await tx.transaction.create({
        data: {
          type,
          amount,
          description:
            dto.description?.trim() || line.memo || 'Lançamento do extrato',
          transactionDate: date,
          operationDate: date,
          bankAccountId: line.bankAccountId,
          cashRegisterId: target.id,
          retroactive: target.retroactive,
          natureId: category.natureId,
          subCategoryId: category.id,
          responsibleId: actor.id,
          responsibleName: actor.name,
        },
      });
      if (target.id) {
        await tx.cashRegister.update({
          where: { id: target.id },
          data:
            type === 'INCOME'
              ? { totalIncomes: { increment: amount } }
              : { totalOutcomes: { increment: amount } },
        });
      }
      await tx.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: 'CREATED',
          transactionId: created.id,
          matchedAt: new Date(),
          matchedByName: actor.name,
        },
      });
    });
    return this.lineView(id);
  }

  /**
   * O depósito da operadora liquida o cartão (CX-6.7, FC-10): a operadora
   * baixa o valor das vendas, a conta recebe o que caiu e a diferença é a
   * taxa de cartão.
   */
  async liquidate(
    companyId: string,
    id: string,
    dto: ConciliationLiquidateDto,
    actor: CashActor,
  ) {
    const line = await this.line(companyId, id);
    if (line.status !== 'UNMATCHED') bad('Esta linha já está conciliada');
    if (line.amount <= 0) bad('Só o depósito da operadora liquida o cartão');
    const card = await this.account(companyId, dto.cardAccountId);
    if (card.kind !== 'CARD') bad('Escolha a conta da operadora de cartão');
    if (dto.gross < line.amount) {
      bad('O valor das vendas não pode ser menor que o depósito');
    }
    const transfer = await this.cashDay.transfer(
      companyId,
      {
        fromId: card.id,
        toId: line.bankAccountId,
        amount: dto.gross,
        fee: dto.gross - line.amount,
        date: lineDay(line.date),
        method: 'Liquidação do cartão',
      },
      actor,
    );
    await this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: 'MATCHED',
        transactionId: transfer.in.id,
        matchedAt: new Date(),
        matchedByName: actor.name,
      },
    });
    return { ...(await this.lineView(id)), fee: dto.gross - line.amount };
  }

  private async lineView(id: string) {
    const line = await this.prisma.bankStatementLine.findUniqueOrThrow({
      where: { id },
    });
    return {
      id: line.id,
      date: lineDay(line.date),
      amount: line.amount,
      memo: line.memo,
      status: line.status,
      transactionId: line.transactionId,
    };
  }
}
