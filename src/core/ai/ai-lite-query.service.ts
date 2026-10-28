import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'nestjs-prisma';
import { AbacService } from '../auth/abac/abac.service';
import { omitMoneyFields } from '../auth/abac/values-visibility.interceptor';
import { CashDayService } from '../financial/cash-control/cash-day.service';
import { CreditCheckService } from '../sale/quotation/credit-check.service';
import {
  dueWhere,
  expiringWhere,
  noContactWhere,
} from '../sale/quotation/follow-up/follow-up.service';
import { ReportService } from '../../svc/report/report.service';
import {
  AiProposalDeniedError,
  AiQuotationDraftService,
} from './ai-quotation-draft.service';
import { AiRequestUser } from './ai.types';

const LIST_LIMIT = 10;

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);

/**
 * As consultas novas do LITE (seção 5.2 do documento de 28/10/2026), sobre os
 * serviços que as telas já usam. O recurso de plano de cada uma é conferido
 * pela ferramenta; aqui, a permissão e o recorte do vendedor. Valores em
 * centavos, e só para quem vê valores (a frente de caixa mostra os valores
 * ao operador, como a tela).
 */
@Injectable()
export class AiLiteQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abacService: AbacService,
    private readonly reports: ReportService,
    private readonly cashDays: CashDayService,
    private readonly credit: CreditCheckService,
    private readonly drafts: AiQuotationDraftService,
  ) {}

  /**
   * O acompanhamento do dia (CRM): próximo contato hoje ou vencido, os
   * aguardando sem contato combinado e as propostas que vencem em 2 dias.
   */
  async followUpToday(user: AiRequestUser) {
    await this.ensure(user, 'view', 'sale:quotation', 'consultar orçamentos');
    const sellerId = await this.sellerScope(user);
    const base: Prisma.QuotationWhereInput = {
      companyId: user.companyId,
      ...(sellerId ? { sellerId } : {}),
    };
    const now = new Date();
    const list = (where: Prisma.QuotationWhereInput) =>
      Promise.all([
        this.prisma.quotation.count({ where: { AND: [base, where] } }),
        this.prisma.quotation.findMany({
          where: { AND: [base, where] },
          select: {
            id: true,
            quotationNumber: true,
            status: true,
            dueDate: true,
            nextContactAt: true,
            nextContactNote: true,
            client: { select: { name: true } },
            seller: { select: { name: true } },
            tag: { select: { title: true } },
            contacts: {
              orderBy: { at: 'desc' },
              take: 1,
              select: { at: true, outcome: true },
            },
          },
          orderBy: [{ nextContactAt: 'asc' }, { dueDate: 'asc' }],
          take: LIST_LIMIT,
        }),
      ]).then(([count, rows]) => ({
        count,
        records: rows.map(({ contacts, client, seller, tag, ...row }) => ({
          ...row,
          client: client?.name ?? null,
          seller: seller?.name ?? null,
          tag: tag?.title ?? null,
          lastContact: contacts[0] ?? null,
        })),
      }));
    const [due, noContact, expiring] = await Promise.all([
      list(dueWhere(now)),
      list(noContactWhere()),
      list(expiringWhere(now)),
    ]);
    return { due, noContact, expiring };
  }

  /** Rejeitados e cancelados por motivo no período (padrão: o relatório). */
  async lostReasons(args: Record<string, unknown>, user: AiRequestUser) {
    await this.ensure(user, 'view', 'sale:quotation', 'consultar orçamentos');
    const sellerId = await this.sellerScope(user);
    const result = await this.reports.getLossesByReason(user.companyId, {
      ...(isDate(args.startDate) ? { startDate: args.startDate } : {}),
      ...(isDate(args.endDate) ? { endDate: args.endDate } : {}),
      ...(sellerId ? { sellerId } : {}),
    } as Parameters<ReportService['getLossesByReason']>[1]);
    return (await this.canSeeValues(user))
      ? result
      : omitMoneyFields(result, new Set(['value']));
  }

  /**
   * Os caixas do dia por conta: aberto ou fechado, o caixa esquecido de outro
   * dia e, para quem vê valores, a abertura, o saldo e a diferença do
   * fechamento. Sem o detalhe das movimentações.
   */
  async cashStatus(user: AiRequestUser) {
    await this.ensure(
      user,
      'view',
      'financial:cash_control',
      'consultar o controle de caixa',
    );
    const values = await this.canSeeValues(user);
    const view = await this.cashDays.list(
      user.companyId,
      { limit: 20 } as Parameters<CashDayService['list']>[1],
      values,
    );
    const accountName = new Map(
      view.accounts.map((account) => [account.id, account.name]),
    );
    return {
      today: view.today,
      accounts: view.accounts
        .filter((account) => account.cashControl || account.todayDay)
        .map((account) => ({
          name: account.name,
          today: account.todayDay?.status ?? 'SEM CAIXA ABERTO',
          forgottenOpenSince: account.stuckDay?.date ?? null,
          ...(values ? { balance: account.balance } : {}),
        })),
      days: view.days.map((day) => ({
        account: accountName.get(day.bankAccountId) ?? null,
        number: day.number,
        date: day.date,
        status: day.status,
        openedBy: day.openedBy,
        closedBy: day.closedBy ?? null,
        ...(values
          ? {
              opening: day.opening,
              balance: day.totals.balance,
              informed: day.informed ?? null,
              difference:
                day.informed === null || day.informed === undefined
                  ? null
                  : day.informed - day.totals.balance,
            }
          : {}),
      })),
    };
  }

  /** As vendas esperando na frente de caixa e o total a receber. */
  async cashFrontQueue(user: AiRequestUser) {
    await this.ensure(
      user,
      'view',
      'financial:pdv',
      'consultar a frente de caixa',
    );
    const open = await this.prisma.cashSession.findMany({
      where: { companyId: user.companyId, status: 'OPEN' },
      select: { id: true },
    });
    // O mesmo recorte da fila da tela (PdvService.state), sem criar o caixa
    // padrão que a tela cria ao abrir
    const sales = await this.prisma.pendingSale.findMany({
      where: {
        companyId: user.companyId,
        path: 'POS',
        cancelled: false,
        OR: [
          { goesToCash: true, delivered: false },
          {
            goesToCash: false,
            billedSessionId: { in: open.map((row) => row.id) },
          },
        ],
      },
      select: {
        kind: true,
        total: true,
        paid: true,
        approvedAt: true,
        quotation: {
          select: {
            quotationNumber: true,
            client: { select: { name: true } },
          },
        },
      },
      orderBy: { approvedAt: 'asc' },
    });
    return {
      openCashFronts: open.length,
      waiting: sales.length,
      toReceive: sales.reduce((sum, sale) => sum + (sale.total - sale.paid), 0),
      sales: sales.slice(0, 15).map((sale) => ({
        quotation: sale.quotation?.quotationNumber ?? null,
        client: sale.quotation?.client?.name ?? null,
        kind: sale.kind,
        total: sale.total,
        paid: sale.paid,
        approvedAt: sale.approvedAt,
      })),
    };
  }

  /** O limite, o usado e o disponível de um cliente, e se está bloqueado. */
  async clientCredit(args: Record<string, unknown>, user: AiRequestUser) {
    await this.ensure(user, 'view', 'register:client', 'consultar clientes');
    if (!(await this.canSeeValues(user))) {
      throw new AiProposalDeniedError(
        'Seu perfil não vê valores: o limite de crédito é valor.',
      );
    }
    const client =
      typeof args.clientId === 'string' && args.clientId
        ? { id: args.clientId, name: null as string | null }
        : await this.drafts
            .matchClient(user.companyId, String(args.clientHint ?? ''))
            .then((match) =>
              match.match === 'EXACT'
                ? { id: match.id, name: match.name }
                : match,
            );
    if (!('id' in client) || !client.id) {
      return {
        found: false,
        candidates:
          'candidates' in client
            ? (client.candidates ?? []).map((c) => c.name)
            : [],
      };
    }
    const credit = await this.credit.clientCredit(user.companyId, client.id);
    if (!credit) return { found: false, candidates: [] };
    return {
      found: true,
      client: client.name,
      blocked: credit.blockClient,
      limit: credit.limit,
      used: credit.used,
      available: credit.available,
      // Antes da data de CREDIT_LIMIT_ENFORCE_FROM o limite só é registrado
      enforcing: credit.applies && credit.enforcing,
    };
  }

  private async ensure(
    user: AiRequestUser,
    action: string,
    resource: string,
    label: string,
  ) {
    const allowed = await this.abacService.hasPermission(
      user,
      action,
      resource,
    );
    if (!allowed) {
      throw new AiProposalDeniedError(`Seu perfil não pode ${label}.`);
    }
  }

  private canSeeValues(user: AiRequestUser) {
    return this.abacService.hasPermission(user, 'view', 'values:values');
  }

  /** Quem não vê os outros vendedores vê só as próprias vendas. */
  private async sellerScope(user: AiRequestUser) {
    const canSeeOthers = await this.abacService.canAccessOtherSellers(user);
    return !canSeeOthers && !user.isAdmin && user.employeeId
      ? user.employeeId
      : undefined;
  }
}
