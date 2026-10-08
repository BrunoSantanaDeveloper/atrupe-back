import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BlockLevel,
  PlanType,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  ACCOUNT_SUBSCRIPTION_WHERE,
  CONTRACTED_MODULE_WHERE,
  currentAccountSubscription,
} from './account-subscription';
import { BillingMode, billingModeOf, billingModeWhere } from './billing-mode';

/** As abas de Gerenciar contas, na ordem dos totais. */
const ACCOUNT_TABS = ['ativas', 'bloqueadas', 'inativas', 'canceladas'];

/** Paginação e filtros de Gerenciar contas (`ListActiveClientsDto`). */
export interface AccountListQuery {
  page?: number;
  limit?: number;
  /** A aba: ativas, bloqueadas, inativas ou canceladas. */
  status?: string;
  search?: string;
  sort?: 'name' | 'updated_at' | 'created_at';
  /** Chave do módulo, `any` (algum módulo) ou `none` (nenhum). */
  module?: string;
  additionalUsers?: 'with' | 'without';
  plan?: PlanType;
  billingMode?: BillingMode;
  /** UF do endereço principal. */
  state?: string;
  groupBy?: 'date' | 'none';
}

/**
 * O que cada linha de Gerenciar contas carrega: as assinaturas de plano pago
 * (a em vigor sai delas), com o limite de usuários do plano e os módulos
 * contratados, e o endereço principal.
 */
const ACCOUNT_INCLUDE = {
  Subscription: {
    where: ACCOUNT_SUBSCRIPTION_WHERE,
    orderBy: { createdAt: 'desc' },
    include: {
      plan: {
        include: {
          planLimits: {
            where: { isActive: true, limit: { key: 'max_users' } },
            select: { value: true },
          },
        },
      },
      subscriptionFeatures: {
        where: CONTRACTED_MODULE_WHERE,
        include: { feature: { select: { key: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  },
  address: { where: { type: 'Principal' }, take: 1 },
} satisfies Prisma.CompanyInclude;

type AccountCompany = Prisma.CompanyGetPayload<{
  include: typeof ACCOUNT_INCLUDE;
}>;

/**
 * Usuário em uso: colaborador ativo com acesso ativo. É a conta do limite de
 * usuários do plano (`PlanControlService.getCurrentUserCount`).
 */
const USER_IN_USE_WHERE = {
  isActive: true,
  userId: { not: null },
  user: { isActive: true },
} satisfies Prisma.EmployeeWhereInput;

/** Os eventos do histórico que mudam o que a conta paga. */
const BILLING_CHANGE_ACTIONS = [
  'CONTRACTED',
  'EVOLUTION_CONTRACTED',
  'COMPLEMENTS_ADDED',
  'MODULE_REMOVED',
  'PLAN_CHANGED_BY_ADMIN',
  'TRANSFER_RECEIVED',
];

/** A situação que Gerenciar contas mostra: o bloqueio pesa mais que o status. */
function accountStatus(blockLevel: BlockLevel, status: SubscriptionStatus) {
  if (blockLevel === 'PARTIAL') return 'BLOCKED';
  if (blockLevel === 'FULL') return 'INACTIVE';
  if (status === 'CANCELED') return 'CANCELED';
  if (status === 'INACTIVE') return 'INACTIVE';
  return 'ACTIVE';
}

@Injectable()
export class AdminDashboardService {
  constructor(private prisma: PrismaService) {}

  async listIncompleteRegistrations(
    page: number = 1,
    limit: number = 10,
    sort: 'name' | 'updated_at' | 'created_at' = 'created_at',
    search?: string,
  ) {
    const skip = (page - 1) * limit;

    // Mapear o campo de ordenação para o campo do Prisma
    const orderByField =
      sort === 'updated_at'
        ? 'updatedAt'
        : sort === 'created_at'
          ? 'createdAt'
          : 'name';

    // Construir filtro de busca
    const whereCondition: any = {};
    if (search) {
      whereCondition.OR = [
        {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          companyName: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          email: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          phone: {
            contains: search,
          },
        },
      ];
    }

    // Buscar todos os registros de MailVerification
    const [mailVerifications, total] = await Promise.all([
      this.prisma.mailVerification.findMany({
        where: whereCondition,
        orderBy: {
          [orderByField]: orderByField === 'name' ? 'asc' : 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.mailVerification.count({
        where: whereCondition,
      }),
    ]);

    // Agrupar por data (updatedAt quando ordenado por últimas alterações, senão createdAt)
    const groupedByDate = mailVerifications.reduce(
      (acc, verification) => {
        const groupDate =
          sort === 'updated_at'
            ? verification.updatedAt
            : verification.createdAt;
        const dateKey = new Date(groupDate).toISOString().split('T')[0];

        if (!acc[dateKey]) {
          acc[dateKey] = [];
        }

        // Gerar código baseado no ID
        const code = verification.id.slice(0, 4).toUpperCase();

        acc[dateKey].push({
          id: verification.id,
          companyName: verification.companyName || null,
          code: code,
          userName: verification.name || null,
          phone: verification.phone || null,
          email: verification.email,
          createdAt: verification.createdAt,
          emailVerified: verification.verified,
          token: verification.token,
          expiresAt: verification.expiresAt,
        });

        return acc;
      },
      {} as Record<string, any[]>,
    );

    // Formatar resposta — ordenar grupos conforme critério selecionado
    const data = Object.entries(groupedByDate)
      .map(([date, items]) => ({
        date,
        data: items,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      data,
      total,
    };
  }

  async getTrialTotals() {
    // Buscar todas as subscriptions TRIAL com status ACTIVE
    const activeTrialSubscriptions = await this.prisma.subscription.findMany({
      where: {
        plan: {
          planType: 'TRIAL',
        },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        companyId: true,
        nextDueDate: true,
        createdAt: true,
      },
    });

    // Buscar todas as subscriptions TRIAL com status INACTIVE
    const inactiveTrialSubscriptions = await this.prisma.subscription.findMany({
      where: {
        plan: {
          planType: 'TRIAL',
        },
        status: 'INACTIVE',
      },
      select: {
        id: true,
        companyId: true,
      },
    });

    const now = new Date();
    let ativas = 0; // Trial ativas que ainda não venceram
    let inativas = 0; // Trial ativas que já venceram
    let descartadas = 0; // Trial inativas sem outra subscription ativa

    // Processar subscriptions ACTIVE
    for (const sub of activeTrialSubscriptions) {
      const daysAfterDueDate = Math.floor(
        (now.getTime() - sub.nextDueDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Se ainda não venceu (data de vencimento no futuro)
      if (daysAfterDueDate < 0) {
        ativas++;
      } else {
        // Venceu ou está vencendo hoje - conta como inativa imediatamente
        inativas++;
      }
    }

    // Processar subscriptions INACTIVE (descartadas)
    // Batch: buscar empresas com outra subscription ativa (evita N+1)
    const inactiveCompanyIds = inactiveTrialSubscriptions.map(
      (s) => s.companyId,
    );
    const inactiveSubIds = inactiveTrialSubscriptions.map((s) => s.id);
    const companiesWithActiveSub = await this.prisma.subscription.findMany({
      where: {
        companyId: { in: inactiveCompanyIds },
        status: 'ACTIVE',
        id: { notIn: inactiveSubIds },
      },
      select: { companyId: true },
      distinct: ['companyId'],
    });
    const companiesWithActiveSet = new Set(
      companiesWithActiveSub.map((s) => s.companyId),
    );

    for (const sub of inactiveTrialSubscriptions) {
      if (!companiesWithActiveSet.has(sub.companyId)) {
        descartadas++;
      }
    }

    return {
      data: {
        ACTIVE: ativas,
        INACTIVE: inativas,
        DISCARDED: descartadas,
        TOTAL: ativas + inativas + descartadas,
      },
    };
  }

  async getActiveTotals() {
    const [active, blocked, inactive, canceled] = await Promise.all(
      ACCOUNT_TABS.map((tab) =>
        this.prisma.company.count({ where: this.accountTabWhere(tab) }),
      ),
    );

    return {
      data: {
        ACTIVE: active,
        BLOCKED: blocked,
        INACTIVE: inactive,
        CANCELED: canceled,
        TOTAL: active + blocked + inactive + canceled,
      },
    };
  }

  async getCompanyHistory(companyId: string) {
    // Buscar a empresa
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        Subscription: {
          include: {
            plan: true,
            history: {
              orderBy: {
                createdAt: 'desc',
              },
            },
            payments: {
              orderBy: {
                createdAt: 'desc',
              },
              take: 50,
            },
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    // Buscar último acesso do usuário (da tabela UserActivity)
    const lastActivity = await this.prisma.userActivity.findFirst({
      where: {
        companyId: companyId,
      },
      orderBy: {
        lastActive: 'desc',
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    // Buscar todos os eventos de histórico de subscription
    const allSubscriptions = company.Subscription || [];
    const allHistory: any[] = [];

    for (const subscription of allSubscriptions) {
      // Adicionar eventos de histórico de subscription
      for (const historyItem of subscription.history || []) {
        allHistory.push({
          ...historyItem,
          type: 'subscription',
        });
      }

      // Adicionar eventos de pagamentos como histórico
      for (const payment of subscription.payments || []) {
        allHistory.push({
          id: payment.id,
          action: `PAYMENT_${payment.status}`,
          description: this.getPaymentDescription(payment.status),
          metadata: {
            paymentId: payment.asaasPaymentId,
            value: payment.value,
            billingType: payment.billingType,
            dueDate: payment.dueDate,
            confirmedDate: payment.confirmedDate,
            paymentDate: payment.paymentDate,
            invoiceUrl: payment.invoiceUrl,
          },
          createdAt: payment.createdAt,
          createdBy: null,
          createdByName: 'Sistema Asaas',
          type: 'payment',
        });
      }
    }

    // Ordenar por data mais recente
    allHistory.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return {
      data: allHistory,
      lastAccess: lastActivity
        ? {
            date: lastActivity.lastActive,
            user: lastActivity.user,
            ipAddress: lastActivity.ipAddress,
          }
        : null,
      company: {
        id: company.id,
        name: company.name,
        isActive: company.isActive,
      },
    };
  }

  private getPaymentDescription(status: string): string {
    const descriptions: Record<string, string> = {
      PENDING: 'Pagamento pendente',
      CONFIRMED: 'Pagamento confirmado',
      RECEIVED: 'Pagamento recebido',
      OVERDUE: 'Pagamento em atraso',
      REFUNDED: 'Pagamento reembolsado',
      CANCELED: 'Pagamento cancelado',
      FAILED: 'Pagamento falhou',
    };
    return descriptions[status] || 'Evento de pagamento';
  }

  /**
   * Gerenciar contas: as empresas com plano pago e o que a cobrança precisa
   * ver de cada uma — módulos, usuários, valor e forma de cobrança.
   *
   * Sem `groupBy`, a resposta sai em grupos por data de contratação, como a
   * tela anterior espera; a tela atual pede `groupBy: 'none'`.
   */
  async listActiveClients(query: AccountListQuery = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where = this.accountsWhere(query);

    const [companies, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        include: ACCOUNT_INCLUDE,
        orderBy: this.accountOrderBy(query.sort),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.company.count({ where }),
    ]);

    const rows = await this.accountRows(companies);
    const lastPage = Math.ceil(total / limit);

    if (query.groupBy === 'none') {
      return { data: rows, total, page, lastPage };
    }

    const groups: Record<string, typeof rows> = {};
    for (const row of rows) {
      const date = row.createdAt.toISOString().split('T')[0];
      (groups[date] ??= []).push(row);
    }
    const data = Object.entries(groups)
      .map(([date, items]) => ({ date, data: items }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return { data, total, lastPage };
  }

  /** A lista filtrada inteira, sem paginação, para a planilha da cobrança. */
  async exportActiveClients(query: AccountListQuery = {}) {
    const companies = await this.prisma.company.findMany({
      where: this.accountsWhere(query),
      include: ACCOUNT_INCLUDE,
      orderBy: this.accountOrderBy(query.sort),
    });
    return { data: await this.accountRows(companies) };
  }

  /** As opções dos filtros de Gerenciar contas: os módulos e as UFs que existem. */
  async getAccountFilterOptions() {
    const [modules, addresses] = await Promise.all([
      // Módulo é recurso pago: o vendido hoje e o que saiu de venda, mas
      // continua contratado em alguma assinatura.
      this.prisma.feature.findMany({
        where: {
          OR: [
            { price: { gt: 0 } },
            { subscriptionFeatures: { some: CONTRACTED_MODULE_WHERE } },
          ],
        },
        select: { key: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.address.findMany({
        where: {
          type: 'Principal',
          state: { not: null },
          company: { Subscription: { some: ACCOUNT_SUBSCRIPTION_WHERE } },
        },
        select: { state: true },
        distinct: ['state'],
        orderBy: { state: 'asc' },
      }),
    ]);

    const states = addresses
      .map((address) => address.state?.trim())
      .filter((state): state is string => !!state);
    return { modules, states: [...new Set(states)] };
  }

  /**
   * O detalhe de uma conta para a cobrança: o resumo da linha de Gerenciar
   * contas, quem usa o sistema, as últimas cobranças e as mudanças de plano e
   * de complementos.
   */
  async getAccountDetails(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: ACCOUNT_INCLUDE,
    });
    if (!company) {
      throw new NotFoundException('Empresa não encontrada');
    }
    const [account] = await this.accountRows([company]);
    if (!account) {
      throw new NotFoundException('A empresa não tem assinatura de plano pago');
    }

    const subscription = currentAccountSubscription(company.Subscription);
    const subscriptionIds = company.Subscription.map((s) => s.id);
    const [employees, payments, changes] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId, ...USER_IN_USE_WHERE },
        select: {
          role: { select: { name: true, isAdmin: true } },
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { user: { name: 'asc' } },
      }),
      this.prisma.payment.findMany({
        where: { subscriptionId: { in: subscriptionIds } },
        orderBy: { dueDate: 'desc' },
        take: 12,
      }),
      this.prisma.subscriptionHistory.findMany({
        where: {
          subscriptionId: { in: subscriptionIds },
          action: { in: BILLING_CHANGE_ACTIONS },
        },
        select: {
          id: true,
          action: true,
          description: true,
          createdAt: true,
          createdByName: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    const users = employees.flatMap(({ role, user }) =>
      user ? [{ role, user }] : [],
    );
    const lastAccess = users.length
      ? await this.prisma.userActivity.groupBy({
          by: ['userId'],
          where: { companyId, userId: { in: users.map((u) => u.user.id) } },
          _max: { lastActive: true },
        })
      : [];
    const lastAccessByUser = new Map(
      lastAccess.map((row) => [row.userId, row._max.lastActive]),
    );

    return {
      account,
      company: {
        name: company.name,
        legalName: company.legalName,
        email: company.email,
        phone: company.phone || company.mobile || null,
        createdAt: company.createdAt,
        blockedAt: company.blockedAt,
        blockReason: company.blockReason,
      },
      subscription: {
        id: subscription.id,
        status: subscription.status,
        billingType: subscription.billingType,
        contractedAt: subscription.contractedAt ?? subscription.createdAt,
        couponCode: subscription.couponCode,
      },
      users: users.map(({ role, user }) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: role?.name ?? null,
        isAdmin: !!role?.isAdmin,
        isOwner: user.id === company.ownerUserId,
        lastAccessAt: lastAccessByUser.get(user.id) ?? null,
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        dueDate: payment.dueDate,
        valueCents: Math.round(payment.value * 100),
        status: payment.status,
        paidAt: payment.paymentDate ?? payment.confirmedDate,
        billingType: payment.billingType,
        description: payment.description,
        invoiceUrl: payment.invoiceUrl,
      })),
      changes,
    };
  }

  /**
   * Em que aba de Gerenciar contas a empresa cai. A mesma regra conta as abas
   * e filtra a lista, para os números baterem.
   */
  private accountTabWhere(tab?: string): Prisma.CompanyWhereInput {
    const sub = (
      where: Prisma.SubscriptionWhereInput = {},
    ): Prisma.SubscriptionWhereInput => ({
      AND: [ACCOUNT_SUBSCRIPTION_WHERE, where],
    });

    switch (tab) {
      case 'ativas':
        return {
          blockLevel: 'NONE',
          Subscription: { some: sub({ status: 'ACTIVE' }) },
        };
      case 'bloqueadas':
        return { blockLevel: 'PARTIAL', Subscription: { some: sub() } };
      case 'inativas':
        return {
          OR: [
            { blockLevel: 'FULL', Subscription: { some: sub() } },
            {
              blockLevel: 'NONE',
              Subscription: {
                some: sub({ status: 'INACTIVE' }),
                none: sub({ status: 'ACTIVE' }),
              },
            },
          ],
        };
      case 'canceladas':
        return {
          blockLevel: 'NONE',
          Subscription: {
            some: sub({ status: 'CANCELED' }),
            none: sub({ status: 'ACTIVE' }),
          },
        };
      default:
        return { Subscription: { some: sub() } };
    }
  }

  /** O filtro de Gerenciar contas: a aba, a busca e os filtros da cobrança. */
  private accountsWhere(query: AccountListQuery): Prisma.CompanyWhereInput {
    const and: Prisma.CompanyWhereInput[] = [
      this.accountTabWhere(query.status),
    ];

    const search = query.search?.trim();
    if (search) {
      // O CNPJ fica gravado só com números; a busca também aceita com máscara.
      const digits = search.replace(/\D/g, '');
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { legalName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { mobile: { contains: search } },
          { cnpj: { contains: search } },
          ...(digits.length >= 3 && digits !== search
            ? [{ cnpj: { contains: digits } }]
            : []),
        ],
      });
    }

    if (query.module) {
      and.push(
        this.onCurrentSubscription(
          query.module === 'none'
            ? { subscriptionFeatures: { none: CONTRACTED_MODULE_WHERE } }
            : {
                subscriptionFeatures: {
                  some:
                    query.module === 'any'
                      ? CONTRACTED_MODULE_WHERE
                      : {
                          ...CONTRACTED_MODULE_WHERE,
                          feature: { key: query.module },
                        },
                },
              },
        ),
      );
    }
    if (query.additionalUsers) {
      and.push(
        this.onCurrentSubscription({
          additionalUsers: query.additionalUsers === 'with' ? { gt: 0 } : 0,
        }),
      );
    }
    if (query.plan) {
      and.push(this.onCurrentSubscription({ plan: { planType: query.plan } }));
    }
    if (query.billingMode) {
      and.push(this.onCurrentSubscription(billingModeWhere(query.billingMode)));
    }
    if (query.state) {
      and.push({
        address: {
          some: {
            type: 'Principal',
            state: { equals: query.state, mode: 'insensitive' },
          },
        },
      });
    }

    return { AND: and };
  }

  /**
   * Condição sobre a assinatura em vigor: a ACTIVE ou, sem nenhuma ativa,
   * alguma das outras — a escolha de `currentAccountSubscription`, até onde o
   * filtro do banco alcança.
   */
  private onCurrentSubscription(
    condition: Prisma.SubscriptionWhereInput,
  ): Prisma.CompanyWhereInput {
    const active: Prisma.SubscriptionWhereInput = {
      AND: [ACCOUNT_SUBSCRIPTION_WHERE, { status: 'ACTIVE' }],
    };
    return {
      OR: [
        { Subscription: { some: { AND: [active, condition] } } },
        {
          Subscription: {
            none: active,
            some: { AND: [ACCOUNT_SUBSCRIPTION_WHERE, condition] },
          },
        },
      ],
    };
  }

  private accountOrderBy(
    sort: AccountListQuery['sort'] = 'name',
  ): Prisma.CompanyOrderByWithRelationInput[] {
    // O id desempata: sem ele, contas de mesmo nome trocam de página.
    if (sort === 'updated_at') return [{ updatedAt: 'desc' }, { id: 'asc' }];
    if (sort === 'created_at') return [{ createdAt: 'desc' }, { id: 'asc' }];
    return [{ name: 'asc' }, { id: 'asc' }];
  }

  /** As linhas de Gerenciar contas, com o que a cobrança precisa ver. */
  private async accountRows(companies: AccountCompany[], now = new Date()) {
    const accounts = companies.flatMap((company) => {
      const subscription = currentAccountSubscription(company.Subscription);
      return subscription ? [{ company, subscription }] : [];
    });
    if (accounts.length === 0) return [];

    const companyIds = accounts.map(({ company }) => company.id);
    const ownerIds = accounts
      .map(({ company }) => company.ownerUserId)
      .filter((id): id is string => !!id);

    const [employees, usersInUse, owners, openCharges] = await Promise.all([
      // A linha segue mostrando o primeiro colaborador com acesso: é ele que
      // Editar e Redefinir senha alteram.
      this.prisma.employee.findMany({
        where: { companyId: { in: companyIds }, userId: { not: null } },
        select: {
          companyId: true,
          cpf: true,
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.employee.groupBy({
        by: ['companyId'],
        where: { companyId: { in: companyIds }, ...USER_IN_USE_WHERE },
        _count: { _all: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true, email: true, phone: true },
      }),
      this.prisma.payment.findMany({
        where: {
          subscriptionId: {
            in: accounts.map(({ subscription }) => subscription.id),
          },
          status: { in: ['PENDING', 'OVERDUE'] },
        },
        select: { subscriptionId: true, status: true, dueDate: true },
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    const firstEmployee = new Map<string, (typeof employees)[number]>();
    for (const employee of employees) {
      if (!firstEmployee.has(employee.companyId)) {
        firstEmployee.set(employee.companyId, employee);
      }
    }
    const inUse = new Map(
      usersInUse.map((group) => [group.companyId, group._count._all]),
    );
    const ownersById = new Map(owners.map((owner) => [owner.id, owner]));
    const chargesBySubscription = new Map<string, typeof openCharges>();
    for (const charge of openCharges) {
      const list = chargesBySubscription.get(charge.subscriptionId) ?? [];
      chargesBySubscription.set(charge.subscriptionId, [...list, charge]);
    }
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    return accounts.map(({ company, subscription }) => {
      const employee = firstEmployee.get(company.id);
      const user = employee?.user;
      const address = company.address[0];
      const billingMode = billingModeOf(subscription);
      const charges = chargesBySubscription.get(subscription.id) ?? [];
      const upcoming = charges.find(
        (charge) =>
          charge.status === 'PENDING' && charge.dueDate >= startOfToday,
      );
      const includedUsers = subscription.plan.planLimits[0]?.value;
      // Sem o limite no plano, ou com -1, o plano não limita usuários.
      const unlimited = includedUsers == null || includedUsers === -1;

      return {
        id: company.id,
        avatar: company.favIconUrl || '',
        companyName: company.legalName || company.name,
        code: `#${company.id.slice(0, 4).toUpperCase()}`,
        document: company.cnpj || '',
        userId: user?.id || '',
        userName: user?.name || '',
        userDocument: employee?.cpf || '',
        phone: user?.phone || company.phone || company.mobile || '',
        email: user?.email || company.email || '',
        createdAt: subscription.createdAt,
        plan: subscription.plan.name,
        planType: subscription.plan.planType,
        status: accountStatus(company.blockLevel, subscription.status),
        state: address?.state
          ? { id: address.state, name: address.state }
          : { id: '', name: '' },
        city: address?.city
          ? { id: address.city, name: address.city }
          : { id: '', name: '' },
        // Titular (Usuário nº 1): quem responde pela conta perante a Atrupe.
        owner: ownersById.get(company.ownerUserId) ?? null,
        subscriptionId: subscription.id,
        cycle: subscription.cycle,
        billingMode,
        installmentCount: subscription.installmentCount,
        // O valor de cada renovação como o Asaas cobra: por mês ou, no
        // anual, pelo ano.
        valueCents: Math.round(subscription.value * 100),
        // Assinatura manual não tem cobrança: a data gravada nela não é
        // vencimento de nada.
        nextChargeDate:
          billingMode === 'MANUAL'
            ? null
            : (upcoming?.dueDate ?? subscription.nextDueDate),
        hasOverdueCharge: charges.some(
          (charge) =>
            charge.status === 'OVERDUE' ||
            (charge.status === 'PENDING' && charge.dueDate < startOfToday),
        ),
        modules: subscription.subscriptionFeatures.map((module) => ({
          key: module.feature.key,
          name: module.feature.name,
          priceCents: Math.round(module.price),
          since: module.createdAt,
        })),
        users: {
          inUse: inUse.get(company.id) ?? 0,
          included: unlimited ? null : includedUsers,
          additional: subscription.additionalUsers,
          limit: unlimited
            ? null
            : includedUsers + subscription.additionalUsers,
          // Preço de hoje no plano: a assinatura guarda só a quantidade.
          additionalUserPriceCents: Math.round(
            subscription.plan.additionalUserPrice ?? 0,
          ),
        },
      };
    });
  }

  async listTrialCompanies(
    page: number = 1,
    limit: number = 10,
    statusFilter?: string,
    sort: 'name' | 'updated_at' | 'created_at' = 'name',
    search?: string,
  ) {
    const skip = (page - 1) * limit;

    // Mapear o campo de ordenação para o campo do Prisma
    let orderByConfig: any;
    if (sort === 'name') {
      orderByConfig = {
        Company: {
          name: 'asc',
        },
      };
    } else if (sort === 'updated_at') {
      orderByConfig = {
        updatedAt: 'desc',
      };
    } else {
      orderByConfig = {
        createdAt: 'desc',
      };
    }

    // Construir condição de busca
    const whereCondition: any = {
      plan: {
        planType: 'TRIAL',
      },
    };

    // Adicionar filtro de busca se fornecido
    if (search) {
      whereCondition.OR = [
        {
          Company: {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          Company: {
            legalName: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          Company: {
            email: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          Company: {
            phone: {
              contains: search,
            },
          },
        },
        {
          Company: {
            mobile: {
              contains: search,
            },
          },
        },
        {
          Company: {
            cnpj: {
              contains: search,
            },
          },
        },
      ];
    }

    // Buscar todas as subscriptions TRIAL
    const allTrialSubscriptions = await this.prisma.subscription.findMany({
      where: whereCondition,
      include: {
        plan: true,
        Company: {
          include: {
            address: {
              where: {
                type: 'Principal',
              },
              take: 1,
            },
          },
        },
        customer: true,
      },
      orderBy: orderByConfig,
    });

    // Filtrar subscriptions baseado na nova lógica de status
    const now = new Date();
    const filteredSubscriptions = [];

    // Batch: buscar empresas INACTIVE que têm outra subscription ativa (evita N+1)
    const inactiveTrialSubs = allTrialSubscriptions.filter(
      (s) => s.status === 'INACTIVE',
    );
    const trialInactiveCompanyIds = inactiveTrialSubs.map((s) => s.companyId);
    const trialInactiveSubIds = inactiveTrialSubs.map((s) => s.id);
    const trialCompaniesWithActive =
      trialInactiveCompanyIds.length > 0
        ? await this.prisma.subscription.findMany({
            where: {
              companyId: { in: trialInactiveCompanyIds },
              status: 'ACTIVE',
              id: { notIn: trialInactiveSubIds },
            },
            select: { companyId: true },
            distinct: ['companyId'],
          })
        : [];
    const trialActiveSet = new Set(
      trialCompaniesWithActive.map((s) => s.companyId),
    );

    for (const sub of allTrialSubscriptions) {
      const daysAfterDueDate = Math.floor(
        (now.getTime() - sub.nextDueDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      let subscriptionCategory: string | null = null;

      // Se ainda não venceu (data de vencimento no futuro)
      if (sub.status === 'ACTIVE' && daysAfterDueDate < 0) {
        subscriptionCategory = 'ativas';
      } else if (sub.status === 'ACTIVE' && daysAfterDueDate >= 0) {
        // Venceu ou está vencendo hoje - move para inativas imediatamente
        subscriptionCategory = 'inativas';
      } else if (sub.status === 'INACTIVE') {
        if (!trialActiveSet.has(sub.companyId)) {
          subscriptionCategory = 'descartadas';
        }
      }

      // Adicionar à lista se corresponder ao filtro ou se não houver filtro
      if (!statusFilter || subscriptionCategory === statusFilter) {
        filteredSubscriptions.push(sub);
      }
    }

    // Aplicar paginação
    const total = filteredSubscriptions.length;
    const subscriptions = filteredSubscriptions.slice(skip, skip + limit);

    // Buscar informações dos usuários (primeiro employee da empresa que tem user)
    const companiesWithUsers = await Promise.all(
      subscriptions.map(async (sub) => {
        if (!sub.Company) return null;

        const employee = await this.prisma.employee.findFirst({
          where: {
            companyId: sub.Company.id,
            userId: {
              not: null,
            },
          },
          include: {
            user: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        });

        const address = sub.Company.address[0];

        // Período de trial: data de criação até nextDueDate
        const trialStart = new Date(sub.createdAt);
        const trialEnd = new Date(sub.nextDueDate);

        const formatDate = (date: Date) => {
          return date.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });
        };

        return {
          subscription: sub,
          company: sub.Company,
          employee,
          address,
          trialPeriod: `${formatDate(trialStart)} - ${formatDate(trialEnd)}`,
        };
      }),
    );

    // Agrupar por data de criação
    const groupedByDate = companiesWithUsers
      .filter((item) => item !== null)
      .reduce(
        (acc, item) => {
          const dateKey = new Date(item.subscription.createdAt)
            .toISOString()
            .split('T')[0];

          if (!acc[dateKey]) {
            acc[dateKey] = [];
          }

          const company = item.company;
          const user = item.employee?.user;

          acc[dateKey].push({
            subscriptionId: item.subscription.id,
            company: {
              id: company.id,
              name: company.name,
            },
            avatar: company.favIconUrl || null,
            companyName: company.legalName || company.name,
            displayName: company.name,
            code: `#${company.id.slice(0, 4).toUpperCase()}`,
            document: company.cnpj || null,
            userName: user?.name || 'N/A',
            phone: user?.phone || company.phone || company.mobile || null,
            email: user?.email || company.email || null,
            trialPeriod: item.trialPeriod,
            stateId: item.address?.state || null,
            cityId: item.address?.city || null,
            createdAt: item.subscription.createdAt,
          });

          return acc;
        },
        {} as Record<string, any[]>,
      );

    // Formatar resposta
    const data = Object.entries(groupedByDate)
      .map(([date, items]) => ({
        date,
        data: items,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const lastPage = Math.ceil(total / limit);

    return {
      data,
      total,
      lastPage,
    };
  }
}
