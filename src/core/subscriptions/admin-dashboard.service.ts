import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';

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
    const nonTrialSub = { plan: { planType: { not: 'TRIAL' as const } } };

    const [active, blocked, inactive, canceled] = await Promise.all([
      // Ativas: blockLevel = NONE + tem sub ACTIVE não-TRIAL
      this.prisma.company.count({
        where: {
          blockLevel: 'NONE',
          Subscription: { some: { status: 'ACTIVE', ...nonTrialSub } },
        },
      }),
      // Bloqueadas: blockLevel = PARTIAL + tem sub não-TRIAL
      this.prisma.company.count({
        where: {
          blockLevel: 'PARTIAL',
          Subscription: { some: nonTrialSub },
        },
      }),
      // Inativas: blockLevel = FULL OU (NONE + sub INACTIVE sem sub ACTIVE)
      this.prisma.company.count({
        where: {
          OR: [
            {
              blockLevel: 'FULL',
              Subscription: { some: nonTrialSub },
            },
            {
              blockLevel: 'NONE',
              Subscription: {
                some: { status: 'INACTIVE', ...nonTrialSub },
                none: { status: 'ACTIVE', ...nonTrialSub },
              },
            },
          ],
        },
      }),
      // Canceladas: blockLevel = NONE + sub CANCELED sem ACTIVE
      this.prisma.company.count({
        where: {
          blockLevel: 'NONE',
          Subscription: {
            some: { status: 'CANCELED', ...nonTrialSub },
            none: { status: 'ACTIVE', ...nonTrialSub },
          },
        },
      }),
    ]);

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

  async listActiveClients(
    page: number = 1,
    limit: number = 10,
    statusFilter?: string,
    search?: string,
    sort: 'name' | 'updated_at' | 'created_at' = 'name',
  ) {
    const skip = (page - 1) * limit;
    const nonTrialSub = { plan: { planType: { not: 'TRIAL' as const } } };

    // Construir where baseado em Company (não mais Subscription)
    const companyWhere: any = {};

    if (statusFilter === 'bloqueadas') {
      companyWhere.blockLevel = 'PARTIAL';
      companyWhere.Subscription = { some: nonTrialSub };
    } else if (statusFilter === 'inativas') {
      companyWhere.OR = [
        {
          blockLevel: 'FULL',
          Subscription: { some: nonTrialSub },
        },
        {
          blockLevel: 'NONE',
          Subscription: {
            some: { status: 'INACTIVE', ...nonTrialSub },
            none: { status: 'ACTIVE', ...nonTrialSub },
          },
        },
      ];
    } else if (statusFilter === 'ativas') {
      companyWhere.blockLevel = 'NONE';
      companyWhere.Subscription = {
        some: { status: 'ACTIVE', ...nonTrialSub },
      };
    } else if (statusFilter === 'canceladas') {
      companyWhere.blockLevel = 'NONE';
      companyWhere.Subscription = {
        some: { status: 'CANCELED', ...nonTrialSub },
        none: { status: 'ACTIVE', ...nonTrialSub },
      };
    } else {
      // Sem filtro: todas as empresas com subscription não-TRIAL
      companyWhere.Subscription = { some: nonTrialSub };
    }

    // Adicionar filtro de busca em campos da Company
    if (search) {
      const searchLower = search.toLowerCase();
      const searchConditions = [
        { name: { contains: searchLower, mode: 'insensitive' as const } },
        { legalName: { contains: searchLower, mode: 'insensitive' as const } },
        { email: { contains: searchLower, mode: 'insensitive' as const } },
        { phone: { contains: search } },
        { mobile: { contains: search } },
        { cnpj: { contains: search } },
      ];

      // Combinar busca com os filtros de status existentes
      if (companyWhere.OR) {
        // Se já tem OR (inativas), wrappear tudo em AND
        const existingOr = companyWhere.OR;
        delete companyWhere.OR;
        companyWhere.AND = [{ OR: existingOr }, { OR: searchConditions }];
      } else {
        companyWhere.OR = searchConditions;
      }
    }

    // Mapear ordenação para campo do Company
    let orderByConfig: any;
    if (sort === 'name') {
      orderByConfig = { name: 'asc' };
    } else if (sort === 'updated_at') {
      orderByConfig = { updatedAt: 'desc' };
    } else {
      orderByConfig = { createdAt: 'desc' };
    }

    // Query por Company com a subscription mais recente não-TRIAL
    const [companies, total] = await Promise.all([
      this.prisma.company.findMany({
        where: companyWhere,
        include: {
          Subscription: {
            where: nonTrialSub,
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { plan: true },
          },
          address: {
            where: { type: 'Principal' },
            take: 1,
          },
        },
        orderBy: orderByConfig,
        skip,
        take: limit,
      }),
      this.prisma.company.count({ where: companyWhere }),
    ]);

    // Buscar informações dos usuários (primeiro employee com user)
    const companiesWithUsers = await Promise.all(
      companies.map(async (company) => {
        const subscription = company.Subscription[0];
        if (!subscription) return null;

        const employee = await this.prisma.employee.findFirst({
          where: {
            companyId: company.id,
            userId: { not: null },
          },
          include: { user: true },
          orderBy: { createdAt: 'asc' },
        });

        const address = company.address[0];

        // Período de assinatura
        const subscriptionStart = new Date(subscription.createdAt);
        const nextDue = new Date(subscription.nextDueDate);

        const formatDate = (date: Date) => {
          return date.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          });
        };

        return {
          company,
          subscription,
          employee,
          address,
          subscriptionPeriod: `${formatDate(subscriptionStart)} - ${formatDate(nextDue)}`,
        };
      }),
    );

    // Agrupar por data de criação (da subscription)
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

          const { company, subscription, employee, address } = item;
          const user = employee?.user;

          const companyData = {
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
            status:
              company.blockLevel === 'PARTIAL'
                ? 'BLOCKED'
                : company.blockLevel === 'FULL'
                  ? 'INACTIVE'
                  : subscription.status === 'CANCELED'
                    ? 'CANCELED'
                    : subscription.status === 'INACTIVE'
                      ? 'INACTIVE'
                      : 'ACTIVE',
            state: address?.state
              ? { id: address.state, name: address.state }
              : { id: '', name: '' },
            city: address?.city
              ? { id: address.city, name: address.city }
              : { id: '', name: '' },
          };

          acc[dateKey].push(companyData);
          return acc;
        },
        {} as Record<string, any[]>,
      );

    // Formatar resposta
    const data = Object.entries(groupedByDate)
      .filter(([, items]) => items.length > 0)
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
