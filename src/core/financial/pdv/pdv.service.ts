import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addMonths } from 'date-fns';
import { PrismaService } from 'nestjs-prisma';
import {
  CashActor,
  MissingCashDay,
  actorOfUser,
  brDay,
  dayRange,
  dayOf,
  postMovement,
  toReais,
  workdayEndOf,
} from '../cash-control/cash-ledger';
import {
  accountForMethod,
  CashMethod,
  METHOD_LABEL,
  ReceiptPart,
  recordSaleReceipt,
  resolveParts,
  roundingOf,
} from '../cash-control/sale-receipt';
import { QuickSaleService } from '../../sale/quick-sale/quick-sale.service';
import { PlanControlService } from '../../plan/plan-control.service';
import { QuotationFinancialService } from '../../sale/quotation/quotation-financial.service';
import { CreditCheckService } from '../../sale/quotation/credit-check.service';
import { saleReference } from '../../sale/quick-sale/quick-sale.rules';
import { cancelProjectOfQuotationInTx } from '../../production/production-follow';
import {
  BillSaleDto,
  CashSessionMovementDto,
  CloseCashSessionDto,
  CashFrontDto,
  OpenCashSessionDto,
  ReceiveSaleDto,
  RejectSaleDto,
} from './dto/pdv.dto';

type Tx = Prisma.TransactionClient;
type User = { userId: string; companyId: string; isAdmin?: boolean };

const bad = (message: string): never => {
  throw new BadRequestException(message);
};

const SALE_NOT_FOUND = 'Venda não encontrada';
const NO_SESSION = 'Nenhum caixa aberto';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

const partsOf = (value: unknown): ReceiptPart[] =>
  Array.isArray(value) ? (value as ReceiptPart[]) : [];

const sumParts = (parts: ReceiptPart[], method?: CashMethod) =>
  parts
    .filter((part) => !method || part.method === method)
    .reduce((total, part) => total + part.amount, 0);

/** O sinal do movimento da sessão no dinheiro da gaveta. */
const SIGN: Record<string, number> = {
  SALE: 1,
  SUPPLY: 1,
  WITHDRAWAL: -1,
  REVERSAL: -1,
};

const SESSION_INCLUDE = {
  cashFront: true,
  movements: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CashSessionInclude;

type SessionRow = Prisma.CashSessionGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

const SALE_INCLUDE = {
  quotation: {
    select: {
      id: true,
      quotationNumber: true,
      clientId: true,
      series: { select: { code: true } },
      client: { select: { name: true, phone: true, mobile: true } },
      seller: { select: { name: true } },
    },
  },
} satisfies Prisma.PendingSaleInclude;

type SaleRow = Prisma.PendingSaleGetPayload<{ include: typeof SALE_INCLUDE }>;

/** O dinheiro que deve estar na gaveta: a abertura e as partes em dinheiro. */
const cashOnHand = (session: {
  openingBalance: number;
  movements: { kind: string; parts: unknown }[];
}) =>
  session.movements.reduce(
    (total, movement) =>
      total + sumParts(partsOf(movement.parts), 'CASH') * SIGN[movement.kind],
    session.openingBalance,
  );

/** O dia da sessão aberta num dia anterior (esquecida, FC-14), ou nulo. */
const staleDay = (session: { openedAt: Date }) => {
  const day = dayOf(session.openedAt);
  return day < dayOf(new Date()) ? day : null;
};

/**
 * A frente de caixa (FC-1 a FC-20): a sessão do operador, a sangria e o
 * suprimento, o fechamento que leva o recebido às contas e a fila das vendas
 * aprovadas. Valores em centavos; quem age é sempre o usuário da sessão.
 */
@Injectable()
export class PdvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quickSale: QuickSaleService,
    private readonly financial: QuotationFinancialService,
    private readonly credit: CreditCheckService,
    private readonly planControl: PlanControlService,
  ) {}

  actorOf(user: { userId?: string; companyId: string }) {
    return actorOfUser(this.prisma, user);
  }

  /* -------------------------------------------------------- cadastro */

  /** A conta da gaveta: a do cadastro, ou a primeira conta Caixa ativa. */
  private async drawerAccount(
    companyId: string,
    drawerAccountId: string | null,
  ) {
    if (drawerAccountId) {
      const chosen = await this.prisma.bankAccount.findFirst({
        where: { id: drawerAccountId, companyId, isActive: true },
        select: { id: true, name: true, kind: true },
      });
      if (chosen) return chosen;
    }
    return this.prisma.bankAccount.findFirst({
      where: { companyId, isActive: true, kind: 'CASH' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, kind: true },
    });
  }

  /**
   * As frentes da empresa. A primeira nasce sozinha ("Caixa 1", padrão,
   * conferência simples, sem tolerância, R$ 1,00 de arredondamento). O
   * cadastro muda pela rota da frente (FC-15).
   */
  private async fronts(companyId: string) {
    const fronts = await this.prisma.cashFront.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (fronts.length) return fronts;
    const drawer = await this.drawerAccount(companyId, null);
    return [
      await this.prisma.cashFront.create({
        data: {
          companyId,
          name: 'Caixa 1',
          isDefault: true,
          drawerAccountId: drawer?.id ?? null,
        },
      }),
    ];
  }

  /* ---------------------------------------------------------- leitura */

  private sessionView(session: SessionRow, accounts: Map<string, string>) {
    return {
      id: session.id,
      number: session.number,
      cashFrontId: session.cashFrontId,
      name: session.cashFront.name,
      operator: session.operatorName,
      openedAt: session.openedAt.toISOString(),
      openingBalance: session.openingBalance,
      status: session.status,
      blindCount: session.cashFront.blindCount,
      shortageTolerance: session.cashFront.shortageTolerance,
      roundingType: session.cashFront.roundingType,
      roundingLimit: session.cashFront.roundingLimit,
      // Aberta num dia anterior: só fecha (FC-14)
      stale: session.status === 'OPEN' && !!staleDay(session),
      closedBy: session.closedByName ?? undefined,
      closingNote: session.closingNote ?? undefined,
      movements: session.movements.map((movement) => ({
        id: movement.id,
        kind: movement.kind,
        description: movement.description,
        createdAt: movement.createdAt.toISOString(),
        reason: movement.reason ?? undefined,
        responsible: movement.responsibleName ?? undefined,
        account: movement.bankAccountId
          ? accounts.get(movement.bankAccountId)
          : undefined,
        bankAccountId: movement.bankAccountId ?? undefined,
        discount: movement.discount || undefined,
        parts: partsOf(movement.parts).map((part) => ({
          method: part.method,
          paymentConditionId: part.paymentConditionId,
          bankAccountId: part.bankAccountId ?? null,
          amount: part.amount,
        })),
      })),
    };
  }

  private async accountNames(companyId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });
    return new Map(accounts.map((account) => [account.id, account.name]));
  }

  /** Quem atende a venda: "Caixa 2 · Paulo Mendes", com a sessão aberta. */
  private async claimers(ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return new Map<string, string>();
    const sessions = await this.prisma.cashSession.findMany({
      where: { id: { in: wanted }, status: 'OPEN' },
      select: {
        id: true,
        operatorName: true,
        cashFront: { select: { name: true } },
      },
    });
    return new Map(
      sessions.map((session) => [
        session.id,
        `${session.cashFront.name} · ${session.operatorName}`,
      ]),
    );
  }

  private saleView(sale: SaleRow, claimers: Map<string, string>) {
    const client = sale.quotation.client;
    return {
      id: sale.id,
      quotationId: sale.quotationId,
      reference: saleReference(sale.quotation),
      client: client?.name ?? '',
      seller: sale.quotation.seller?.name ?? '',
      kind: sale.kind,
      total: sale.total,
      paid: sale.paid,
      delivered: sale.delivered,
      approvedAt: sale.approvedAt.toISOString(),
      goesToCash: sale.goesToCash,
      claimedBy: sale.claimedSessionId
        ? (claimers.get(sale.claimedSessionId) ?? null)
        : null,
      billing: sale.billing ?? null,
      ready: sale.ready,
      readyAt: sale.readyAt?.toISOString() ?? null,
      phone: client?.mobile || client?.phone || null,
    };
  }

  private async mySession(companyId: string, userId: string) {
    return this.prisma.cashSession.findFirst({
      where: { companyId, operatorId: userId, status: 'OPEN' },
      include: SESSION_INCLUDE,
    });
  }

  /**
   * O estado da frente de caixa: a sessão do operador (aberta, ou a última
   * fechada) e a fila. A fila tem as vendas a receber e as que aguardam
   * retirada; as faturadas para o cliente ficam como registro até o
   * fechamento do caixa que faturou (FC-4).
   */
  async state(user: User) {
    await this.fronts(user.companyId);
    const session =
      (await this.mySession(user.companyId, user.userId)) ??
      (await this.prisma.cashSession.findFirst({
        where: { companyId: user.companyId, operatorId: user.userId },
        orderBy: { openedAt: 'desc' },
        include: SESSION_INCLUDE,
      }));
    const open = await this.prisma.cashSession.findMany({
      where: { companyId: user.companyId, status: 'OPEN' },
      select: { id: true },
    });
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
      include: SALE_INCLUDE,
      orderBy: { approvedAt: 'asc' },
    });
    const claimers = await this.claimers(sales.map((s) => s.claimedSessionId));
    // Os caixas de outros operadores esquecidos abertos de um dia anterior:
    // quem tem a permissão de fechar fecha, com justificativa (FC-14)
    const forgotten = await this.prisma.cashSession.findMany({
      where: {
        companyId: user.companyId,
        status: 'OPEN',
        operatorId: { not: user.userId },
        openedAt: { lt: dayRange(dayOf(new Date())).gte },
      },
      include: SESSION_INCLUDE,
      orderBy: { openedAt: 'asc' },
    });
    const accounts = await this.accountNames(user.companyId);
    return {
      session: session ? this.sessionView(session, accounts) : null,
      sales: sales.map((sale) => this.saleView(sale, claimers)),
      openCashFronts: open.length,
      // O aviso antes do bloqueio do dia seguinte (FC-14)
      workdayEnd: await workdayEndOf(this.prisma, user.companyId),
      forgotten: forgotten.map((row) => this.sessionView(row, accounts)),
    };
  }

  /* ----------------------------------------------------------- sessão */

  /**
   * Abre a sessão do operador com o troco da gaveta. Uma sessão aberta por
   * frente e por operador; sem frente escolhida, a primeira livre, e com
   * todas ocupadas nasce a próxima ("Caixa 2"), com o cadastro da padrão.
   */
  async openSession(user: User, dto: OpenCashSessionDto, actor: CashActor) {
    const mine = await this.mySession(user.companyId, user.userId);
    if (mine) {
      const day = staleDay(mine);
      bad(
        day
          ? `Seu caixa de ${brDay(day)} ainda está aberto: feche-o antes de abrir outro`
          : 'Você já tem um caixa aberto: feche-o antes de abrir outro',
      );
    }
    const fronts = await this.fronts(user.companyId);
    const busy = await this.prisma.cashSession.findMany({
      where: { companyId: user.companyId, status: 'OPEN' },
      select: { cashFrontId: true, operatorName: true, openedAt: true },
    });
    let front = dto.cashFrontId
      ? fronts.find((item) => item.id === dto.cashFrontId)
      : fronts.find((item) => !busy.some((row) => row.cashFrontId === item.id));
    if (dto.cashFrontId && !front) bad('Frente de caixa não encontrada');
    const occupied = busy.find((row) => row.cashFrontId === front?.id);
    // FC-14: a sessão de outro dia ainda aberta na frente também bloqueia
    if (occupied) {
      const day = staleDay(occupied);
      bad(
        day
          ? `Este caixa ficou aberto em ${brDay(day)} por ${occupied.operatorName}: quem tem a permissão fecha o caixa esquecido, com justificativa`
          : `Este caixa já está aberto por ${occupied.operatorName}`,
      );
    }
    if (!front) {
      const model = fronts[0];
      front = await this.prisma.cashFront.create({
        data: {
          companyId: user.companyId,
          name: `Caixa ${fronts.length + 1}`,
          blindCount: model.blindCount,
          shortageTolerance: model.shortageTolerance,
          roundingType: model.roundingType,
          roundingLimit: model.roundingLimit,
          drawerAccountId: model.drawerAccountId,
        },
      });
    }
    // Ligar a frente de caixa liga o controle de caixa na gaveta (CX-1)
    const controlEnabled = await this.enableDrawerControl(
      user.companyId,
      front.drawerAccountId,
    );
    const last = await this.prisma.cashSession.aggregate({
      where: { companyId: user.companyId },
      _max: { number: true },
    });
    const created = await this.prisma.cashSession.create({
      data: {
        companyId: user.companyId,
        cashFrontId: front.id,
        number: (last._max.number ?? 0) + 1,
        operatorId: actor.id,
        operatorName: actor.name,
        openingBalance: dto.openingBalance,
      },
      include: SESSION_INCLUDE,
    });
    return { ...this.sessionView(created, new Map()), controlEnabled };
  }

  /**
   * Liga o controle de caixa na conta da gaveta (CX-1): a frente de caixa
   * entrega o dinheiro nela, conferido no caixa do dia. Devolve o nome da
   * conta quando ligou, para a tela avisar.
   */
  private async enableDrawerControl(
    companyId: string,
    drawerAccountId: string | null,
  ) {
    const drawer = await this.drawerAccount(companyId, drawerAccountId);
    if (!drawer) return null;
    const account = await this.prisma.bankAccount.findUnique({
      where: { id: drawer.id },
      select: { cashControl: true },
    });
    if (account?.cashControl) return null;
    await this.prisma.bankAccount.update({
      where: { id: drawer.id },
      data: { cashControl: true },
    });
    return drawer.name;
  }

  /**
   * A sessão aberta do operador (ou qualquer uma, para o administrador). A
   * esquecida de outro dia, quem tem a permissão de fechar também fecha
   * (destravamento, FC-14).
   */
  private async ownSession(
    user: User,
    id: string,
    options: { forgotten?: boolean } = {},
  ) {
    const session = await this.prisma.cashSession.findFirst({
      where: { id, companyId: user.companyId },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new NotFoundException('Caixa não encontrado');
    if (
      session.operatorId !== user.userId &&
      !user.isAdmin &&
      !(options.forgotten && staleDay(session))
    ) {
      throw new ForbiddenException('Este caixa é de outro operador');
    }
    if (session.status !== 'OPEN') bad(NO_SESSION);
    return session;
  }

  /** FC-14: o caixa de um dia anterior ainda aberto não lança; fecha antes. */
  private assertCurrent(session: { openedAt: Date }) {
    const day = staleDay(session);
    if (day) {
      bad(
        `O caixa de ${brDay(day)} ainda está aberto: feche-o antes de lançar`,
      );
    }
  }

  private missingDay(error: unknown, what: string): never {
    if (error instanceof MissingCashDay) bad(`${error.message}: ${what}`);
    throw error;
  }

  /**
   * Sangria ou suprimento (FC-8): dinheiro mudando de lugar, com motivo e
   * responsável, fora do resultado (CX-5). A sangria chega à conta aguardando
   * a aprovação do caixa principal, como o dinheiro do fechamento (CX-4).
   */
  async movement(
    user: User,
    id: string,
    dto: CashSessionMovementDto,
    actor: CashActor,
  ) {
    const session = await this.ownSession(user, id);
    this.assertCurrent(session);
    if (!dto.reason?.trim()) {
      bad(
        'Informe o motivo: sangria e suprimento registram motivo e responsável',
      );
    }
    if (!dto.amount || dto.amount <= 0) bad('Informe o valor');
    const account = dto.bankAccountId
      ? await this.prisma.bankAccount.findFirst({
          where: {
            id: dto.bankAccountId,
            companyId: user.companyId,
            isActive: true,
          },
          select: { id: true, name: true, kind: true },
        })
      : await this.drawerAccount(
          user.companyId,
          session.cashFront.drawerAccountId,
        );
    if (!account) bad('Escolha a conta de origem ou destino do dinheiro');
    if (account.kind === 'CARD') {
      bad('A conta da operadora de cartão não recebe nem entrega dinheiro');
    }
    const withdrawal = dto.kind === 'WITHDRAWAL';
    if (withdrawal && dto.amount > cashOnHand(session)) {
      bad('A sangria não pode passar do dinheiro em gaveta');
    }
    const reason = dto.reason.trim();
    try {
      await this.prisma.$transaction(async (tx) => {
        await postMovement(tx, {
          bankAccountId: account.id,
          type: withdrawal ? 'TRANSFER_INCOME' : 'TRANSFER_OUTCOME',
          amount: toReais(dto.amount),
          description: `${withdrawal ? 'Sangria' : 'Suprimento'} do caixa FC nº ${session.number}`,
          date: new Date(),
          reason,
          awaitingApproval: withdrawal && account.kind === 'CASH',
          responsible: actor,
        });
        await tx.cashSessionMovement.create({
          data: {
            sessionId: session.id,
            kind: dto.kind,
            description: withdrawal
              ? `Sangria → ${account.name}`
              : `Suprimento ← ${account.name}`,
            parts: [{ method: 'CASH', amount: dto.amount }],
            reason,
            responsibleId: actor.id,
            responsibleName: actor.name,
            bankAccountId: account.id,
          },
        });
      });
    } catch (error) {
      this.missingDay(error, 'a sangria e o suprimento lançam nele');
    }
    return this.sessionView(
      await this.ownSession(user, id),
      await this.accountNames(user.companyId),
    );
  }

  /**
   * Fecha a sessão (FC-7, 4.2): a diferença entre o esperado e o contado é
   * quebra no nome do operador, salvo dentro da tolerância. O recebido vai
   * às contas, um movimento por forma ("Fechamento FC nº N · forma"): o
   * dinheiro contado, menos o que fica na gaveta, na conta Caixa aguardando
   * aprovação; PIX no banco; cartão na operadora pelo valor cheio (FC-10).
   */
  async close(
    user: User,
    id: string,
    dto: CloseCashSessionDto,
    actor: CashActor,
  ) {
    const session = await this.ownSession(user, id, { forgotten: true });
    const keep = dto.keep ?? 0;
    if (keep < 0 || keep > dto.countedCash) {
      bad('O valor que fica na gaveta não pode passar do contado');
    }
    const note = dto.note?.trim() ?? '';
    const expected = cashOnHand(session);
    const difference = dto.countedCash - expected;
    const tolerance = session.cashFront.shortageTolerance;
    const posted =
      difference !== 0 &&
      (tolerance === null || Math.abs(difference) > tolerance);
    if (posted && !note) bad('A contagem não bate: explique a diferença');
    // Fechar o caixa esquecido de outro operador pede justificativa; a
    // diferença fica no nome de quem operava (FC-14)
    if (session.operatorId !== actor.id && !note) {
      bad('Informe a justificativa do fechamento do caixa de outro operador');
    }

    // PIX e cartão por conta: o recebido menos o estornado
    const byAccount = new Map<
      string,
      {
        method: CashMethod;
        bankAccountId: string;
        amount: number;
        net: number;
      }
    >();
    // A taxa da operadora de cada forma de cartão, à vista (FC-10): só
    // previsão; a taxa de verdade é a da liquidação
    const cardConditions = [
      ...new Set(
        session.movements.flatMap((movement) =>
          partsOf(movement.parts)
            .filter((part) => part.method === 'CARD')
            .map((part) => part.paymentConditionId),
        ),
      ),
    ];
    const rates = new Map(
      (
        await this.prisma.installment.findMany({
          where: {
            paymentConditionId: { in: cardConditions },
            installment: 1,
          },
          select: { paymentConditionId: true, operatorFeeRate: true },
        })
      ).map((row) => [row.paymentConditionId, row.operatorFeeRate]),
    );
    for (const movement of session.movements) {
      if (movement.kind !== 'SALE' && movement.kind !== 'REVERSAL') continue;
      for (const part of partsOf(movement.parts)) {
        if (part.method === 'CASH' || !part.bankAccountId) continue;
        const key = `${part.method}:${part.bankAccountId}`;
        const row = byAccount.get(key) ?? {
          method: part.method,
          bankAccountId: part.bankAccountId,
          amount: 0,
          net: 0,
        };
        row.amount += part.amount * SIGN[movement.kind];
        const rate =
          part.method === 'CARD'
            ? (rates.get(part.paymentConditionId) ?? 0)
            : 0;
        row.net +=
          Math.round(part.amount * (1 - rate / 100)) * SIGN[movement.kind];
        byAccount.set(key, row);
      }
    }
    const cashOut = dto.countedCash - keep;
    const cashTransfer = posted ? cashOut - difference : cashOut;
    const drawer = await this.drawerAccount(
      user.companyId,
      session.cashFront.drawerAccountId,
    );
    if (!drawer && (cashTransfer !== 0 || posted)) {
      bad(
        'Cadastre a conta Caixa (gaveta) em Contas bancárias para fechar a frente de caixa',
      );
    }
    const names = await this.accountNames(user.companyId);
    const transfers: {
      method: CashMethod;
      amount: number;
      bankAccountId: string;
      destination: string;
      pending?: boolean;
      // Cartão: o líquido previsto pela taxa da forma (FC-10)
      net?: number;
    }[] = [];
    const date = new Date();
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const post = (
            bankAccountId: string,
            amount: number,
            description: string,
            extra: Partial<Parameters<typeof postMovement>[1]> = {},
          ) =>
            postMovement(tx, {
              bankAccountId,
              type: amount > 0 ? 'TRANSFER_INCOME' : 'TRANSFER_OUTCOME',
              amount: toReais(Math.abs(amount)),
              description,
              date,
              responsible: actor,
              ...extra,
            });
          if (drawer && cashTransfer !== 0) {
            await post(
              drawer.id,
              cashTransfer,
              `Fechamento FC nº ${session.number} · Dinheiro`,
              { awaitingApproval: cashTransfer > 0 },
            );
            transfers.push({
              method: 'CASH',
              amount: cashTransfer,
              bankAccountId: drawer.id,
              destination: drawer.name,
              pending: cashTransfer > 0,
            });
          }
          if (drawer && posted) {
            await postMovement(tx, {
              bankAccountId: drawer.id,
              type: difference < 0 ? 'OUTCOME' : 'INCOME',
              kind: difference < 0 ? 'SHORTAGE' : 'OVERAGE',
              amount: toReais(Math.abs(difference)),
              description: `Diferença da contagem · FC nº ${session.number}`,
              date,
              reason: note,
              // A quebra fica no nome de quem operava
              responsible: {
                id: session.operatorId,
                name: session.operatorName,
              },
            });
          }
          for (const row of byAccount.values()) {
            if (!row.amount) continue;
            await post(
              row.bankAccountId,
              row.amount,
              `Fechamento FC nº ${session.number} · ${METHOD_LABEL[row.method]}`,
            );
            transfers.push({
              method: row.method,
              amount: row.amount,
              bankAccountId: row.bankAccountId,
              destination: names.get(row.bankAccountId) ?? '',
              ...(row.method === 'CARD' ? { net: row.net } : {}),
            });
          }
          await tx.cashSession.update({
            where: { id: session.id },
            data: {
              status: 'CLOSED',
              closedAt: date,
              countedCash: dto.countedCash,
              keep,
              expected,
              difference,
              closingNote: note || null,
              closedById: actor.id,
              closedByName: actor.name,
            },
          });
          // A reserva das vendas que este caixa puxou e não recebeu se solta
          await tx.pendingSale.updateMany({
            where: { claimedSessionId: session.id, paid: 0 },
            data: { claimedSessionId: null },
          });
        },
        { timeout: 20000 },
      );
    } catch (error) {
      this.missingDay(error, 'o fechamento da frente de caixa lança nele');
    }
    const billed = await this.prisma.pendingSale.findMany({
      where: { billedSessionId: session.id, cancelled: false },
      include: SALE_INCLUDE,
    });
    return {
      note: note || undefined,
      countedCash: dto.countedCash,
      expected,
      difference,
      posted,
      keep,
      transfers,
      billed: billed.map((sale) => ({
        reference: saleReference(sale.quotation),
        client: sale.quotation.client?.name ?? '',
        total: sale.total,
        billing: sale.billing ?? '',
      })),
    };
  }

  /* ------------------------------------------------------------- fila */

  private async sale(companyId: string, id: string) {
    const sale = await this.prisma.pendingSale.findFirst({
      where: { id, companyId, path: 'POS', cancelled: false },
      include: SALE_INCLUDE,
    });
    if (!sale) throw new NotFoundException(SALE_NOT_FOUND);
    return sale;
  }

  private async view(sale: SaleRow) {
    return this.saleView(sale, await this.claimers([sale.claimedSessionId]));
  }

  /** Quem atende a venda, quando é outro caixa aberto. */
  private async otherClaimer(sale: SaleRow, mine: string | null) {
    if (!sale.claimedSessionId || sale.claimedSessionId === mine) return null;
    const claimers = await this.claimers([sale.claimedSessionId]);
    return claimers.get(sale.claimedSessionId) ?? null;
  }

  /** Com mais de um caixa, o operador puxa a venda para si (FC-5). */
  async claim(user: User, id: string) {
    const sale = await this.sale(user.companyId, id);
    const session = await this.mySession(user.companyId, user.userId);
    if (!session) bad('Abra o caixa antes de atender');
    this.assertCurrent(session);
    const other = await this.otherClaimer(sale, session.id);
    if (other) bad(`Esta venda já está com o ${other}`);
    await this.prisma.pendingSale.update({
      where: { id: sale.id },
      data: { claimedSessionId: session.id },
    });
    return this.view(await this.sale(user.companyId, id));
  }

  /**
   * Devolve a venda à fila (FC-5): quem a puxou e ainda não recebeu nada
   * dela. O administrador devolve a de qualquer caixa.
   */
  async release(user: User, id: string) {
    const sale = await this.sale(user.companyId, id);
    if (!sale.claimedSessionId) return this.view(sale);
    const session = await this.mySession(user.companyId, user.userId);
    if (sale.claimedSessionId !== session?.id && !user.isAdmin) {
      bad('Só o caixa que puxou a venda a devolve à fila');
    }
    if (sale.paid > 0) {
      bad('A venda já tem valor recebido: ela fica com o caixa que recebeu');
    }
    await this.prisma.pendingSale.update({
      where: { id: sale.id },
      data: { claimedSessionId: null },
    });
    return this.view(await this.sale(user.companyId, id));
  }

  /**
   * Recebe a venda (FC-2, FC-9, FC-12, FC-17, FC-18): pagamento misto, com o
   * troco já descontado da parte em dinheiro, sinal mínimo, arredondamento
   * como desconto e a entrega à parte. Cada parte guarda a forma e a conta.
   */
  async receive(
    user: User,
    id: string,
    dto: ReceiveSaleDto,
    actor: CashActor,
    canWaive: boolean,
  ) {
    const sale = await this.sale(user.companyId, id);
    if (!sale.goesToCash) bad('Esta venda foi faturada para o cliente');
    const session = await this.mySession(user.companyId, user.userId);
    if (!session) bad('Abra o caixa antes de receber');
    this.assertCurrent(session);
    const other = await this.otherClaimer(sale, session.id);
    if (other) bad(`Esta venda está sendo atendida no ${other}`);
    const discount = dto.discount ?? 0;
    const limit = roundingOf(session.cashFront, sale.total);
    if (discount > limit) {
      bad(
        `O arredondamento no balcão vai até ${money(limit)}. Acima disso, vale o limite de desconto do perfil do vendedor`,
      );
    }
    const amount = sumParts(dto.parts);
    const total = sale.total - discount;
    const remaining = total - sale.paid;
    if (amount <= 0 && !(dto.deliver && remaining <= 0)) {
      bad('Informe o valor recebido');
    }
    if (amount > remaining) {
      bad(
        'O valor recebido passa do que falta: o troco sai da parte em dinheiro',
      );
    }
    if (dto.deliver && amount < remaining) {
      bad('Para entregar, receba o valor que falta');
    }
    // O sinal mínimo da venda rápida que o cliente paga agora e busca
    // depois (FC-6, FC-17); quem tem a permissão dispensa caso a caso
    const settings = await this.quickSale.settings(user.companyId);
    if (
      settings.downPaymentRequired &&
      sale.kind === 'QUICK' &&
      sale.paid === 0 &&
      !dto.deliver
    ) {
      const minimum = Math.ceil((total * settings.downPaymentPercent) / 100);
      if (amount < minimum) {
        if (!dto.waiveDownPayment) {
          bad(`O sinal mínimo desta venda é ${money(minimum)}`);
        }
        if (!canWaive) {
          throw new ForbiddenException(
            'Dispensar o sinal exige a permissão "Dispensar sinal"',
          );
        }
      }
    }
    const reference = saleReference(sale.quotation);
    const date = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        const parts = await resolveParts(tx, user.companyId, dto.parts, {
          cashNeedsAccount: false,
          frontAccounts: {
            PIX: session.cashFront.pixAccountId,
            CARD: session.cashFront.cardAccountId,
          },
        });
        if (parts.length) {
          await tx.cashSessionMovement.create({
            data: {
              sessionId: session.id,
              kind: 'SALE',
              description: `${reference} · ${sale.quotation.client?.name ?? ''}`,
              parts,
              discount,
              change: dto.change ?? 0,
              responsibleId: actor.id,
              responsibleName: actor.name,
              pendingSaleId: sale.id,
            },
          });
          const categories = await this.financial.findSalesCategories(
            sale.companyId,
            tx,
          );
          await recordSaleReceipt(tx, {
            companyId: sale.companyId,
            quotationId: sale.quotationId,
            clientId: sale.quotation.clientId,
            reference,
            total,
            parts,
            mode: 'drawer',
            date,
            actor,
            ...categories,
          });
        }
        await tx.pendingSale.update({
          where: { id: sale.id },
          data: {
            total,
            paid: sale.paid + amount,
            discount: sale.discount + discount,
            change: dto.change ?? 0,
            delivered: sale.delivered || !!dto.deliver,
            claimedSessionId: session.id,
            parts: [...partsOf(sale.parts), ...parts],
          },
        });
      },
      { timeout: 20000 },
    );
    return this.view(await this.saleRow(sale.id));
  }

  private saleRow(id: string) {
    return this.prisma.pendingSale.findUniqueOrThrow({
      where: { id },
      include: SALE_INCLUDE,
    });
  }

  /**
   * Trabalho pronto e não retirado (FC-19): sai de "A receber" e vai para
   * "Aguardando retirada". Com o gerenciador, a conclusão do projeto marca.
   */
  async ready(user: User, id: string) {
    const sale = await this.sale(user.companyId, id);
    if (sale.delivered) bad('A venda já foi entregue');
    await this.prisma.pendingSale.update({
      where: { id: sale.id },
      data: { ready: true, readyAt: new Date() },
    });
    return this.view(await this.saleRow(sale.id));
  }

  /**
   * Dá baixa no trabalho não retirado (FC-19): o que não foi pago vira
   * perda, com o sinal abatendo; encerra a venda com quem e quando.
   */
  async discard(user: User, id: string, reason: string, actor: CashActor) {
    const sale = await this.prisma.pendingSale.findFirst({
      where: {
        id,
        companyId: user.companyId,
        path: 'POS',
        cancelled: false,
        ready: true,
        delivered: false,
      },
    });
    if (!sale) throw new NotFoundException('Trabalho não encontrado');
    if (!reason?.trim()) bad('Descartar exige justificativa');
    const loss = Math.max(0, sale.total - sale.paid);
    const discardedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      // O que faltava receber sai do a receber como perda
      const receivables = await tx.receivable.findMany({
        where: { quotationId: sale.quotationId, status: { not: 'CANCELED' } },
        select: { id: true },
      });
      for (const receivable of receivables) {
        await tx.receivableInstallment.updateMany({
          where: { receivableId: receivable.id, status: 'PENDING' },
          data: { status: 'CANCELED' },
        });
        const paid = await tx.receivableInstallment.count({
          where: { receivableId: receivable.id, status: 'PAID' },
        });
        await tx.receivable.update({
          where: { id: receivable.id },
          data: {
            status: paid ? 'PAID' : 'CANCELED',
            cancelReason: `Trabalho não retirado: ${reason.trim()}`,
          },
        });
      }
      await tx.pendingSale.update({
        where: { id: sale.id },
        data: {
          cancelled: true,
          cancelledAt: discardedAt,
          cancelReason: reason.trim(),
          loss,
          discardedByName: actor.name,
          discardedAt,
          claimedSessionId: null,
        },
      });
      await this.orderHistory(
        tx,
        sale.quotationId,
        'DISCARDED',
        `Trabalho não retirado descartado por ${actor.name}: perda de ${money(loss)}`,
        actor,
      );
    });
    return {
      loss,
      discardedBy: actor.name,
      discardedAt: discardedAt.toISOString(),
    };
  }

  private async orderHistory(
    tx: Tx,
    quotationId: string,
    action: string,
    description: string,
    actor: CashActor,
  ) {
    const order = await tx.order.findUnique({
      where: { quotationId },
      select: { id: true },
    });
    if (!order) return;
    await tx.orderHistory.create({
      data: {
        orderId: order.id,
        action,
        description,
        createdBy: actor.id,
        createdByName: actor.name,
      } as Prisma.OrderHistoryUncheckedCreateInput,
    });
  }

  /**
   * Rejeita a venda da fila que ainda não recebeu nada (FC-13.1,
   * 27/10/2026): o cliente desistiu no balcão. O orçamento volta a
   * "rejeitado", com o motivo do cadastro quando houver, a O.S. e a agenda
   * são canceladas e a venda sai da fila. Sem estorno: nada entrou. Com
   * valor recebido, o caminho é o cancelamento com estorno (`reverse`).
   */
  async reject(user: User, id: string, dto: RejectSaleDto, actor: CashActor) {
    const sale = await this.sale(user.companyId, id);
    if (sale.cancelled) bad('Esta venda já foi cancelada');
    if (sale.paid > 0) {
      bad(
        'Esta venda já recebeu um valor: use "Cancelar a venda", que faz o estorno',
      );
    }
    if (!sale.goesToCash) {
      bad('Esta venda já foi faturada para o cliente: cancele pelo Fluxo');
    }
    // O motivo segue a regra da rejeição do orçamento: o cadastro de motivos
    // é recurso de plano (LITE); com ele e algum motivo de rejeição
    // cadastrado, é obrigatório. Só vale motivo de rejeição
    const hasReasons = await this.planControl.hasFeature(
      user.companyId,
      'quotation_rejection_reasons',
    );
    if (dto.reasonId && !hasReasons) {
      await this.planControl.enforceFeature(
        user.companyId,
        'quotation_rejection_reasons',
      );
    }
    if (
      hasReasons &&
      !dto.reasonId &&
      (await this.prisma.reasons.count({
        where: { companyId: user.companyId, type: 'REJECTION' },
      })) > 0
    ) {
      bad('Informe o motivo da rejeição');
    }
    const reason = dto.reasonId
      ? await this.prisma.reasons.findFirst({
          where: {
            id: dto.reasonId,
            companyId: user.companyId,
            type: 'REJECTION',
          },
          select: { id: true, reason: true },
        })
      : null;
    if (dto.reasonId && !reason) bad('Motivo de rejeição não encontrado');
    const why = reason ? reason.reason : 'Rejeitada no caixa';
    await this.prisma.$transaction(
      async (tx) => {
        await tx.quotation.update({
          where: { id: sale.quotationId },
          data: {
            status: 'REJECTED',
            ...(reason ? { reasonId: reason.id } : {}),
          },
        });
        await tx.deliverySchedule.updateMany({
          where: { quotationId: sale.quotationId },
          data: { status: 'CANCELED' },
        });
        await cancelProjectOfQuotationInTx(tx, sale.quotationId, {
          userId: actor.id,
          name: actor.name,
        });
        await tx.order.updateMany({
          where: { quotationId: sale.quotationId },
          data: { status: 'CANCELED', canceledAt: new Date() },
        });
        await tx.pendingSale.update({
          where: { id: sale.id },
          data: {
            cancelled: true,
            cancelledAt: new Date(),
            cancelReason: why,
            claimedSessionId: null,
          },
        });
        await tx.quotationHistory.create({
          data: {
            quotationId: sale.quotationId,
            action: 'REJECTED',
            description: `Venda rejeitada no caixa por ${actor.name}${reason ? `: ${reason.reason}` : ''}`,
            createdBy: actor.id,
            createdByName: actor.name,
          } as Prisma.QuotationHistoryUncheckedCreateInput,
        });
        await this.orderHistory(
          tx,
          sale.quotationId,
          'CANCELED',
          `Venda rejeitada no caixa por ${actor.name}${reason ? `: ${reason.reason}` : ''}`,
          actor,
        );
      },
      { timeout: 20000 },
    );
    return { rejected: true, reason: reason?.reason ?? null };
  }

  /**
   * Cancela a venda com estorno (FC-13, ALT-7): o que foi pago volta pelas
   * formas e contas em que entrou, num movimento da sessão aberta; o título
   * e a O.S. são cancelados. Recebida num caixa já fechado, só o
   * administrador estorna.
   */
  async reverse(user: User, id: string, reason: string, actor: CashActor) {
    const sale = await this.sale(user.companyId, id);
    if (!reason?.trim()) bad('O estorno exige justificativa');
    const parts = partsOf(sale.parts);
    const session = sale.paid
      ? await this.mySession(user.companyId, user.userId)
      : null;
    if (sale.paid && !session) bad('Abra o caixa antes de estornar');
    if (session) this.assertCurrent(session);
    const closed = await this.prisma.cashSessionMovement.count({
      where: {
        pendingSaleId: sale.id,
        kind: 'SALE',
        session: { status: 'CLOSED' },
      },
    });
    if (closed && !user.isAdmin) {
      throw new ForbiddenException(
        'Esta venda foi recebida num caixa já fechado: só o administrador estorna',
      );
    }
    if (session && sumParts(parts, 'CASH') > cashOnHand(session)) {
      bad(
        'A gaveta não tem o dinheiro para devolver: faça um suprimento antes',
      );
    }
    // As partes juntas por forma e conta: um estorno por onde entrou
    const merged = new Map<string, ReceiptPart>();
    for (const part of parts) {
      const key = `${part.method}:${part.paymentConditionId}:${part.bankAccountId ?? ''}`;
      const row = merged.get(key) ?? { ...part, amount: 0 };
      row.amount += part.amount;
      merged.set(key, row);
    }
    const reversal = [...merged.values()].filter((part) => part.amount > 0);
    const why = reason.trim();
    const movement = await this.prisma.$transaction(
      async (tx) => {
        const created =
          session && reversal.length
            ? await tx.cashSessionMovement.create({
                data: {
                  sessionId: session.id,
                  kind: 'REVERSAL',
                  description: `Cancelamento de ${saleReference(sale.quotation)}`,
                  parts: reversal,
                  reason: why,
                  responsibleId: actor.id,
                  responsibleName: actor.name,
                  pendingSaleId: sale.id,
                },
              })
            : null;
        const receivables = await tx.receivable.findMany({
          where: { quotationId: sale.quotationId, status: { not: 'CANCELED' } },
          select: { id: true },
        });
        for (const receivable of receivables) {
          await tx.receivableInstallment.updateMany({
            where: { receivableId: receivable.id },
            data: { status: 'CANCELED' },
          });
          await tx.receivable.update({
            where: { id: receivable.id },
            data: {
              status: 'CANCELED',
              cancelReason: `Estorno no caixa: ${why}`,
            },
          });
        }
        await tx.deliverySchedule.updateMany({
          where: { quotationId: sale.quotationId },
          data: { status: 'CANCELED' },
        });
        await cancelProjectOfQuotationInTx(tx, sale.quotationId, {
          userId: actor.id,
          name: actor.name,
        });
        await tx.order.updateMany({
          where: { quotationId: sale.quotationId },
          data: { status: 'CANCELED', canceledAt: new Date() },
        });
        await tx.pendingSale.update({
          where: { id: sale.id },
          data: {
            cancelled: true,
            cancelledAt: new Date(),
            cancelReason: why,
            claimedSessionId: null,
          },
        });
        await this.orderHistory(
          tx,
          sale.quotationId,
          'CANCELED',
          `Venda cancelada no caixa por ${actor.name}: ${why}`,
          actor,
        );
        return created;
      },
      { timeout: 20000 },
    );
    return {
      reversal: {
        id: movement?.id ?? null,
        parts: reversal.map((part) => ({
          method: part.method,
          amount: part.amount,
        })),
      },
    };
  }

  /**
   * Reverte a venda rápida para faturamento no nome do cliente (FC-4): sai
   * da fila e vai para o fluxo financeiro, com as parcelas na forma
   * escolhida. Só cliente com cadastro aprovado e liberado para a forma.
   */
  async bill(user: User, id: string, dto: BillSaleDto, actor: CashActor) {
    const sale = await this.sale(user.companyId, id);
    if (!sale.goesToCash || sale.kind !== 'QUICK') bad(SALE_NOT_FOUND);
    if (!dto.clientId) bad('Escolha o cliente');
    if (!dto.paymentConditionId || !dto.dueDate) {
      bad('Informe a forma de pagamento e o vencimento');
    }
    if (sale.paid > 0) {
      bad(
        'A venda já tem sinal recebido. Estorne o sinal antes de faturar para o cliente',
      );
    }
    const session = await this.mySession(user.companyId, user.userId);
    if (!session) bad('Abra o caixa antes de faturar');
    this.assertCurrent(session);
    const client = await this.prisma.client.findFirst({
      where: { id: dto.clientId, companyId: user.companyId },
      select: { id: true, name: true, status: true },
    });
    if (!client) bad('Cliente não encontrado');
    if (client.status !== 'ACTIVE') {
      bad('Só cliente com cadastro aprovado pode ser faturado');
    }
    const condition = await this.prisma.paymentCondition.findFirst({
      where: {
        id: dto.paymentConditionId,
        companyId: user.companyId,
        isActive: true,
      },
      select: { id: true, name: true },
    });
    if (!condition) bad('Forma de pagamento não encontrada');
    const credit = await this.credit.clientCredit(user.companyId, client.id);
    if (credit?.blockClient)
      bad('Este cliente está bloqueado para faturamento');
    if (
      credit?.allowedConditionIds &&
      !credit.allowedConditionIds.includes(condition.id)
    ) {
      bad(`${condition.name} não está liberada para este cliente`);
    }
    if (
      credit?.applies &&
      credit.enforcing &&
      credit.limit !== null &&
      credit.used + toReais(sale.total) > credit.limit
    ) {
      bad('O faturamento passa do limite de crédito do cliente');
    }
    const qty = dto.installmentQty;
    const first = new Date(`${dto.dueDate.slice(0, 10)}T12:00:00`);
    const billing =
      qty > 1
        ? `${qty}x · 1º vencimento ${brDay(dayOf(first))}`
        : `Vencimento ${brDay(dayOf(first))}`;
    const reference = saleReference(sale.quotation);
    await this.prisma.$transaction(async (tx) => {
      await tx.quotation.update({
        where: { id: sale.quotationId },
        data: { clientId: client.id },
      });
      await tx.quotationPayment.updateMany({
        where: { quotationId: sale.quotationId },
        data: { paymentConditionId: condition.id, installmentQty: qty },
      });
      // A conta em que a parcela deve cair: a que o sistema escolhe para a
      // forma (CX-2, sem a "padrão" marcada)
      const bankAccountId = await accountForMethod(
        tx,
        user.companyId,
        condition.id,
      );
      const categories = await this.financial.findSalesCategories(
        sale.companyId,
        tx,
      );
      const base = Math.floor(sale.total / qty);
      await tx.receivable.create({
        data: {
          companyId: sale.companyId,
          clientId: client.id,
          quotationId: sale.quotationId,
          description: `Venda ${reference}`,
          reference,
          referenceDate: new Date(),
          notes: dto.notes?.trim() || null,
          totalAmount: toReais(sale.total),
          totalValue: toReais(sale.total),
          installmentQty: qty,
          ...categories,
          installments: {
            create: Array.from({ length: qty }, (_, index) => ({
              installmentNumber: index + 1,
              dueDate: addMonths(first, index),
              // O resto dos centavos na última parcela
              amount: toReais(
                index === qty - 1 ? sale.total - base * (qty - 1) : base,
              ),
              paymentConditionId: condition.id,
              bankAccountId,
              status: 'PENDING' as const,
            })),
          },
        },
      });
      await tx.pendingSale.update({
        where: { id: sale.id },
        data: {
          goesToCash: false,
          billing,
          billedSessionId: session.id,
          claimedSessionId: null,
        },
      });
      await this.orderHistory(
        tx,
        sale.quotationId,
        'BILLED',
        `Venda rápida faturada para ${client.name} no caixa por ${actor.name}`,
        actor,
      );
    });
    return this.view(await this.saleRow(sale.id));
  }

  /* ------------------------------------------------- cadastro (FC-15) */

  private frontView(
    front: Prisma.CashFrontGetPayload<object>,
    accounts: Map<string, string>,
    open: Set<string>,
  ) {
    return {
      id: front.id,
      name: front.name,
      isDefault: front.isDefault,
      isActive: front.isActive,
      blindCount: front.blindCount,
      shortageTolerance: front.shortageTolerance,
      roundingType: front.roundingType,
      roundingLimit: front.roundingLimit,
      drawerAccountId: front.drawerAccountId,
      drawerAccount: front.drawerAccountId
        ? (accounts.get(front.drawerAccountId) ?? null)
        : null,
      pixAccountId: front.pixAccountId,
      pixAccount: front.pixAccountId
        ? (accounts.get(front.pixAccountId) ?? null)
        : null,
      cardAccountId: front.cardAccountId,
      cardAccount: front.cardAccountId
        ? (accounts.get(front.cardAccountId) ?? null)
        : null,
      open: open.has(front.id),
    };
  }

  /** As frentes da empresa, com a padrão primeiro. */
  async listFronts(companyId: string) {
    await this.fronts(companyId);
    const [fronts, accounts, open] = await Promise.all([
      this.prisma.cashFront.findMany({
        where: { companyId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
      this.accountNames(companyId),
      this.prisma.cashSession.findMany({
        where: { companyId, status: 'OPEN' },
        select: { cashFrontId: true },
      }),
    ]);
    const openFronts = new Set(open.map((row) => row.cashFrontId));
    return fronts.map((front) => this.frontView(front, accounts, openFronts));
  }

  /** Confere e monta o que muda no cadastro. */
  private async frontData(companyId: string, dto: CashFrontDto) {
    const data: Prisma.CashFrontUncheckedUpdateInput = {};
    if (dto.name !== undefined) {
      if (!dto.name.trim()) bad('Dê um nome para a frente de caixa');
      data.name = dto.name.trim();
    }
    if (dto.blindCount !== undefined) data.blindCount = dto.blindCount;
    if (dto.shortageTolerance !== undefined) {
      data.shortageTolerance = dto.shortageTolerance;
    }
    if (dto.roundingType !== undefined) data.roundingType = dto.roundingType;
    if (dto.roundingType === 'PERCENT' && (dto.roundingLimit ?? 0) > 10000) {
      bad('O arredondamento em percentual vai até 100%');
    }
    if (dto.roundingLimit !== undefined) data.roundingLimit = dto.roundingLimit;
    if (dto.drawerAccountId !== undefined) {
      if (dto.drawerAccountId) {
        const drawer = await this.prisma.bankAccount.findFirst({
          where: {
            id: dto.drawerAccountId,
            companyId,
            isActive: true,
            kind: 'CASH',
          },
          select: { id: true },
        });
        if (!drawer) {
          bad('A gaveta precisa ser uma conta Caixa (caixa físico) da empresa');
        }
      }
      data.drawerAccountId = dto.drawerAccountId || null;
    }
    // A conta do PIX e a do cartão (CX-2): conta da empresa, ativa, que não
    // seja um caixa físico
    for (const [field, label] of [
      ['pixAccountId', 'PIX'],
      ['cardAccountId', 'cartão'],
    ] as const) {
      const value = dto[field];
      if (value === undefined) continue;
      if (value) {
        const account = await this.prisma.bankAccount.findFirst({
          where: {
            id: value,
            companyId,
            isActive: true,
            kind: { not: 'CASH' },
          },
          select: { id: true },
        });
        if (!account) {
          bad(
            `A conta do ${label} precisa ser um banco ou uma operadora da empresa`,
          );
        }
      }
      data[field] = value || null;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    return data;
  }

  private async afterFrontSave(companyId: string, id: string) {
    const front = await this.prisma.cashFront.findUniqueOrThrow({
      where: { id },
    });
    // Uma padrão por empresa: marcar numa desmarca nas outras; sem nenhuma
    // ativa marcada, a mais antiga ativa vira a padrão
    if (front.isDefault && front.isActive) {
      await this.prisma.cashFront.updateMany({
        where: { companyId, id: { not: id } },
        data: { isDefault: false },
      });
    }
    const defaults = await this.prisma.cashFront.count({
      where: { companyId, isActive: true, isDefault: true },
    });
    if (!defaults) {
      const first = await this.prisma.cashFront.findFirst({
        where: { companyId, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (first) {
        await this.prisma.cashFront.update({
          where: { id: first.id },
          data: { isDefault: true },
        });
      }
    }
    const view = (await this.listFronts(companyId)).find(
      (row) => row.id === id,
    );
    return view;
  }

  /** Cria uma frente de caixa (FC-5, FC-15), com o cadastro da padrão. */
  async createFront(companyId: string, dto: CashFrontDto) {
    if (!dto.name?.trim()) bad('Dê um nome para a frente de caixa');
    const [model] = await this.fronts(companyId);
    const data = await this.frontData(companyId, dto);
    const created = await this.prisma.cashFront.create({
      data: {
        companyId,
        name: dto.name.trim(),
        blindCount: model.blindCount,
        shortageTolerance: model.shortageTolerance,
        roundingType: model.roundingType,
        roundingLimit: model.roundingLimit,
        drawerAccountId: model.drawerAccountId,
        pixAccountId: model.pixAccountId,
        cardAccountId: model.cardAccountId,
        ...(data as Prisma.CashFrontUncheckedCreateInput),
        isDefault: !!dto.isDefault,
        isActive: dto.isActive ?? true,
      } as Prisma.CashFrontUncheckedCreateInput,
    });
    return this.afterFrontSave(companyId, created.id);
  }

  /** Muda o cadastro da frente (FC-7, FC-18, CX-2). */
  async updateFront(companyId: string, id: string, dto: CashFrontDto) {
    const front = await this.prisma.cashFront.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!front) throw new NotFoundException('Frente de caixa não encontrada');
    if (dto.isActive === false) {
      const open = await this.prisma.cashSession.count({
        where: { cashFrontId: id, status: 'OPEN' },
      });
      if (open) bad('Feche o caixa aberto nesta frente antes de desativá-la');
    }
    const data = await this.frontData(companyId, dto);
    await this.prisma.cashFront.update({ where: { id }, data });
    return this.afterFrontSave(companyId, id);
  }
}
