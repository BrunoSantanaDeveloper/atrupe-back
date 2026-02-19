import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import { UpdateActiveClientDto } from './dto/update-active-client.dto';
import {
  AsaasCreateSubscriptionPayload,
  AsaasSubscriptionResponse,
  AsaasUpdateSubscriptionPayload,
} from './interfaces/asaas.interfaces';
import { PrismaService } from 'src/config/prisma/prisma.service';
import axios from 'axios';
import { CustomersService } from '../customers/customers.service';
import { asaasConfig } from 'src/config/configuration';
import { v4 as uuidv4 } from 'uuid';
import * as argon2 from 'argon2';

const TRIAL_DAYS_DEFAULT = 7;
const NEXT_DUE_DATE_DAYS_DEFAULT = 30;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private customerService: CustomersService,
  ) {}
  private asaasToken = asaasConfig.token;
  private asaasApiUrl = asaasConfig.apiUrl;

  private asaasApi() {
    const api = axios.create({
      baseURL: this.asaasApiUrl,
      headers: {
        common: {
          'Content-Type': 'application/json',
          access_token: this.asaasToken,
          'User-Agent': 'Atrupe',
        },
      },
    });

    return api;
  }

  async findActiveByCompanyId(companyId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        companyId,
      },
      include: {
        plan: {
          include: {
            planFeatures: {
              include: {
                feature: true,
              },
            },
            planLimits: {
              include: {
                limit: true,
              },
            },
          },
        },
        customer: true,
        subscriptionFeatures: {
          include: {
            feature: true,
          },
        },
      },
    });
  }

  async listIncompleteRegistrations(
    page: number = 1,
    limit: number = 10,
    sort: 'name' | 'updated_at' | 'created_at' = 'name',
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

    // Agrupar por data de criação
    const groupedByDate = mailVerifications.reduce(
      (acc, verification) => {
        const dateKey = new Date(verification.createdAt)
          .toISOString()
          .split('T')[0];

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

  async create(createSubscriptionDto: CreateSubscriptionDto, request) {
    createSubscriptionDto.customer.userId = request.user.userId;
    createSubscriptionDto.customer.companyId = request.user.companyId;
    const { customer } = createSubscriptionDto;

    // NOTA: A verificação de duplicatas agora será feita dentro da transação
    // para evitar race conditions. O constraint único no banco também previne duplicatas.

    // Get plan from database
    const [plan, additionalFeatures] = await Promise.all([
      this.prisma.plan.findUnique({
        where: { id: createSubscriptionDto.planId },
      }),
      createSubscriptionDto.additionalFeatures?.length
        ? this.prisma.feature.findMany({
            where: { key: { in: createSubscriptionDto.additionalFeatures } },
          })
        : Promise.resolve([]),
    ]);

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    // Buscar customer existente ou criar um novo
    let finalCustomer: any;
    const existingCustomer = await this.prisma.customer.findFirst({
      where: {
        companyId: createSubscriptionDto.companyId,
      },
    });

    if (existingCustomer) {
      this.logger.log('Cliente encontrado:', existingCustomer.name);

      // Verificar se o customer existente é um trial (não criado no Asaas ainda)
      if (existingCustomer.asaasCustomerId?.startsWith('trial_')) {
        this.logger.log('Cliente trial detectado, criando no Asaas...');

        // Criar o customer no Asaas com os dados recebidos
        const customerDataForAsaas = {
          name: customer.name,
          cpfCnpj: customer.document,
          email: customer.email,
          phone: customer.phone,
          mobilePhone: customer.phone,
          postalCode: customer.postalCode,
          addressNumber: customer.addressNumber,
          complement: customer.complement,
          externalReference: existingCustomer.id,
        };

        try {
          const asaasCustomer = await this.asaasApi().post(
            '/customers',
            customerDataForAsaas,
          );

          // Atualizar o customer no banco com o ID real do Asaas
          finalCustomer = await this.prisma.customer.update({
            where: { id: existingCustomer.id },
            data: {
              asaasCustomerId: asaasCustomer.data.id,
              // Atualizar também os dados do customer com os dados recebidos
              name: customer.name,
              document: customer.document,
              email: customer.email,
              phone: customer.phone,
              postalCode: customer.postalCode,
              address: customer.address,
              addressNumber: customer.addressNumber,
              complement: customer.complement,
              province: customer.province,
              city: customer.city,
              state: customer.state,
            },
          });

          this.logger.log(
            'Cliente criado no Asaas com sucesso:',
            asaasCustomer.data.id,
          );
        } catch (error) {
          const errorResponse = error.response?.data.errors;
          const errorDescription = errorResponse
            ?.map((err) => err.description)
            .join(', ');

          this.logger.error('Erro ao criar cliente no Asaas:', {
            message: error.message,
            response: errorResponse,
          });

          throw new BadRequestException(
            errorDescription || 'Falha ao criar cliente no Asaas',
          );
        }
      } else {
        finalCustomer = existingCustomer;
      }
    } else {
      this.logger.log('customer not found, creating...');
      finalCustomer = await this.customerService.create(customer);
    }

    // Soma o preço das features adicionais selecionadas
    const additionalFeaturesValue = additionalFeatures.reduce(
      (acc, feature) => acc + (feature.price || 0),
      0,
    );
    this.logger.debug(
      `Valor total dos módulos adicionais: ${additionalFeaturesValue}`,
    );

    // Soma o preço da quantidade de usuários adicionais
    const additionalUsersValue =
      (plan.additionalUserPrice || 0) *
      (createSubscriptionDto.additionalUsers || 0);
    this.logger.debug(
      `Valor total de usuários adicionais: ${additionalUsersValue}`,
    );

    const planPrice = plan.basePrice;
    this.logger.debug(`Preço base do plano: ${planPrice}`);

    // Soma o valor total a ser cobrado em centavos e divide por 100
    const value =
      (planPrice + additionalFeaturesValue + additionalUsersValue) / 100;
    this.logger.debug(`Valor final: ${value}`);

    try {
      // Primeiro criar a subscription no banco para obter o ID
      // Serializable isolation previne que dois checkouts concorrentes
      // ambos leiam "sem subscription ativa" e criem duplicatas
      const subscription = await this.prisma.$transaction(async (tx) => {
        // Verificar dentro da transação se já existe uma subscription não-TRIAL
        // que esteja ACTIVE ou INACTIVE (aguardando pagamento)
        // Ambos os status indicam que já há um checkout em andamento ou concluído
        const existingSubscription = await tx.subscription.findFirst({
          where: {
            companyId: request.user.companyId,
            status: { in: ['ACTIVE', 'INACTIVE'] },
            plan: {
              planType: {
                not: 'TRIAL',
              },
            },
          },
        });

        // Se existe uma subscription não-TRIAL (ativa ou aguardando pagamento), impede a criação
        if (existingSubscription) {
          throw new BadRequestException(
            existingSubscription.status === 'ACTIVE'
              ? 'Uma assinatura ativa já existe para esta empresa.'
              : 'Um checkout já está em andamento para esta empresa. Aguarde a confirmação do pagamento.',
          );
        }

        // Criar nova subscription com status INACTIVE
        // A subscription só será ativada quando o pagamento for confirmado via webhook
        // Nesse momento, o webhook também desativará a subscription TRIAL se existir
        const newSubscription = await tx.subscription.create({
          data: {
            customerId: finalCustomer.id,
            planId: plan.id,
            companyId: request.user.companyId,
            additionalUsers: createSubscriptionDto.additionalUsers || 0,
            asaasSubscriptionId: `temp_${uuidv4()}`, // Temporário único, será atualizado após criação no Asaas
            nextDueDate: new Date(
              Date.now() + 1000 * 60 * 60 * 24 * NEXT_DUE_DATE_DAYS_DEFAULT,
            ),
            cycle: 'MONTHLY',
            billingType: createSubscriptionDto.billingType,
            value,
            status: 'INACTIVE', // Inativo até pagamento ser confirmado
          },
        });

        // Adicionar features extras à subscription
        if (additionalFeatures.length > 0) {
          for (const feature of additionalFeatures) {
            await tx.subscriptionFeature.create({
              data: {
                subscriptionId: newSubscription.id,
                featureId: feature.id,
                price: feature.price,
                isActive: true,
              },
            });
          }
        }

        return newSubscription;
      });

      // Agora criar a subscription no Asaas usando o ID do banco como externalReference
      const data = {
        customer: finalCustomer.asaasCustomerId,
        billingType: createSubscriptionDto.billingType,
        value,
        nextDueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2), // 2 dias
        cycle: 'MONTHLY',
        description: `Assinatura ${plan.name}`,
        externalReference: subscription.id, // ID do banco de dados
        callback: {
          successUrl: createSubscriptionDto.successUrl,
        },
      };

      const asaasSubscription = await this.createSubscription(data);

      // Atualizar a subscription local com o ID do Asaas
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          asaasSubscriptionId: asaasSubscription.id,
          nextDueDate: new Date(asaasSubscription.nextDueDate),
        },
      });

      // Buscar a primeira cobrança criada automaticamente pelo Asaas
      this.logger.log('Buscando primeira cobrança criada pelo Asaas');

      const asaasPayments = await this.getAsaasSubscriptionPayments(
        asaasSubscription.id,
      );

      if (!asaasPayments || asaasPayments.length === 0) {
        throw new BadRequestException(
          'Asaas não criou a primeira cobrança automaticamente',
        );
      }

      // Pegar a primeira cobrança (a mais recente)
      const firstAsaasPayment = asaasPayments[0];

      // Salvar a cobrança do Asaas no nosso banco
      const firstPayment = await this.prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          asaasPaymentId: firstAsaasPayment.id,
          asaasCustomerId: finalCustomer.asaasCustomerId,
          value: firstAsaasPayment.value,
          dueDate: new Date(firstAsaasPayment.dueDate),
          billingType: firstAsaasPayment.billingType,
          description: firstAsaasPayment.description,
          externalReference: firstAsaasPayment.id,
          status: this.mapAsaasPaymentStatus(firstAsaasPayment.status),
          invoiceUrl: firstAsaasPayment.invoiceUrl,
          bankSlipUrl: firstAsaasPayment.bankSlipUrl,
          pixQrCode: firstAsaasPayment.pixQrCodeId,
          pixCopyPaste: firstAsaasPayment.encodedImage,
        },
      });

      this.logger.log('Subscription e Payment criados com sucesso');

      // Retornar subscription + payment com URL de pagamento
      return {
        subscription,
        payment: {
          id: firstPayment.id,
          asaasPaymentId: firstPayment.asaasPaymentId,
          value: firstPayment.value,
          status: firstPayment.status,
          paymentUrl: firstPayment.invoiceUrl,
          bankSlipUrl: firstPayment.bankSlipUrl,
          pixQrCode: firstPayment.pixQrCode,
          pixCopyPaste: firstPayment.pixCopyPaste,
          dueDate: firstPayment.dueDate,
        },
      };
    } catch (error) {
      this.logger.error('Erro ao criar subscription:', error);
      throw new BadRequestException(error.message);
    }
  }

  async upgrade(subscriptionId: string, newPlanId: string, request) {
    // Buscar subscription atual
    const currentSubscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        customer: true,
        subscriptionFeatures: { include: { feature: true } },
      },
    });

    if (!currentSubscription) {
      throw new NotFoundException('Subscription not found');
    }

    // Verificar se a subscription pertence à empresa do usuário
    if (currentSubscription.companyId !== request.user.companyId) {
      throw new BadRequestException('Unauthorized access to this subscription');
    }

    // Buscar o novo plano
    const newPlan = await this.prisma.plan.findUnique({
      where: { id: newPlanId },
    });

    if (!newPlan) {
      throw new NotFoundException('New plan not found');
    }

    // Calcular valor dos módulos extras da subscription atual
    const featuresValue = (currentSubscription.subscriptionFeatures || [])
      .filter((sf) => sf.isActive !== false)
      .reduce((sum, sf) => sum + (sf.price || 0), 0);

    // Calcular novo valor da subscription (converter centavos para reais)
    const newValue =
      (newPlan.basePrice +
        featuresValue +
        (newPlan.additionalUserPrice || 0) *
          (currentSubscription.additionalUsers || 0)) /
      100;

    // Cancelar subscription atual no Asaas (se necessário)
    try {
      await this.cancelAsaasSubscription(
        currentSubscription.asaasSubscriptionId,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to cancel old subscription in Asaas: ${error.message}`,
      );
    }

    // Criar nova subscription no Asaas
    const asaasData = {
      billingType: currentSubscription.billingType,
      cycle: currentSubscription.cycle,
      customer: currentSubscription.customer.asaasCustomerId,
      value: newValue,
      nextDueDate: new Date(
        Date.now() + 1000 * 60 * 60 * 24 * NEXT_DUE_DATE_DAYS_DEFAULT,
      ),
      description: `Upgrade para ${newPlan.name}`,
      callback: {
        successUrl: 'https://homolog.atrupe.com.br',
      },
    };

    const asaasSubscription = await this.createSubscription(asaasData);

    // Desativar subscription atual
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'INACTIVE' },
    });

    // Criar nova subscription
    const newSubscription = await this.prisma.subscription.create({
      data: {
        customerId: currentSubscription.customerId,
        companyId: currentSubscription.companyId,
        planId: newPlan.id,
        additionalUsers: currentSubscription.additionalUsers,
        asaasSubscriptionId: asaasSubscription.id,
        // modules array foi removido - usar subscriptionFeatures
        nextDueDate: new Date(asaasSubscription.nextDueDate),
        cycle: currentSubscription.cycle,
        billingType: currentSubscription.billingType,
        value: newValue,
        status: asaasSubscription.status,
      },
      include: {
        plan: true,
        customer: true,
      },
    });
    // Copiar subscriptionFeatures da subscription antiga para a nova
    const activeFeatures = (
      currentSubscription.subscriptionFeatures || []
    ).filter((sf) => sf.isActive !== false);

    if (activeFeatures.length > 0) {
      for (const sf of activeFeatures) {
        await this.prisma.subscriptionFeature.create({
          data: {
            subscriptionId: newSubscription.id,
            featureId: sf.featureId,
            price: sf.price,
            isActive: true,
          },
        });
      }

      this.logger.log(
        `Copiadas ${activeFeatures.length} features para nova subscription ${newSubscription.id}`,
      );
    }

    return newSubscription;
  }

  async addModule(subscriptionId: string, moduleId: string, request) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        customer: true,
        subscriptionFeatures: { include: { feature: true } },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.companyId !== request.user.companyId) {
      throw new BadRequestException('Unauthorized access to this subscription');
    }

    // Verificar se a feature existe
    const feature = await this.prisma.feature.findUnique({
      where: { key: moduleId },
    });

    if (!feature) {
      throw new NotFoundException('Feature not found');
    }

    // Verificar se a feature já está incluída na subscription
    if (
      subscription.subscriptionFeatures.some(
        (sf) => sf.feature.key === moduleId,
      )
    ) {
      throw new BadRequestException('Module already included in subscription');
    }

    // Criar a nova subscription feature
    await this.prisma.subscriptionFeature.create({
      data: {
        subscriptionId,
        featureId: feature.id,
        price: feature.price,
      },
    });

    // Calcular valor sem features extras
    const plan = await this.prisma.plan.findUnique({
      where: { id: subscription.planId },
    });

    // Calcular valor dos módulos extras (incluindo o recém-adicionado)
    const updatedFeatures = await this.prisma.subscriptionFeature.findMany({
      where: { subscriptionId, isActive: true },
    });
    const modulesValue = updatedFeatures.reduce(
      (sum, sf) => sum + (sf.price || 0),
      0,
    );
    const newValue =
      (plan.basePrice +
        modulesValue +
        (plan.additionalUserPrice || 0) * (subscription.additionalUsers || 0)) /
      100;

    // Atualizar subscription no Asaas
    try {
      await this.updateAsaasSubscription(subscription.asaasSubscriptionId, {
        value: newValue,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to update subscription in Asaas: ${error.message}`,
      );
    }

    // Atualizar subscription local
    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        // modules array foi removido - agora usar subscriptionFeatures
        value: newValue,
      },
      include: {
        plan: true,
        customer: true,
      },
    });

    // Registrar no histórico
    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId,
        action: 'MODULE_ADDED',
        description: `Módulo ${feature.name || moduleId} adicionado`,
        changes: {
          before: { value: subscription.value },
          after: { value: newValue, moduleKey: moduleId },
        },
        metadata: {
          featureId: feature.id,
          featureKey: moduleId,
          featurePrice: feature.price,
        },
        createdByName: request.user?.name || 'Sistema',
      },
    });

    return updated;
  }

  async removeModule(subscriptionId: string, moduleId: string, request) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        customer: true,
        plan: true,
        subscriptionFeatures: { include: { feature: true } },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.companyId !== request.user.companyId) {
      throw new BadRequestException('Unauthorized access to this subscription');
    }

    // Verificar se a feature está na subscription
    if (
      !subscription.subscriptionFeatures.some(
        (sf) => sf.feature.key === moduleId,
      )
    ) {
      throw new BadRequestException('Module not found in subscription');
    }

    // Verificar se a feature é obrigatória do plano
    const planHasFeature = await this.prisma.planFeature.findFirst({
      where: { planId: subscription.planId, feature: { key: moduleId } },
    });
    if (planHasFeature) {
      throw new BadRequestException(
        'Cannot remove module that is required by the plan',
      );
    }

    // Remover feature da subscription
    // Remover feature da subscription
    const subscriptionFeature = subscription.subscriptionFeatures.find(
      (sf) => sf.feature.key === moduleId,
    );
    if (subscriptionFeature) {
      await this.prisma.subscriptionFeature.delete({
        where: { id: subscriptionFeature.id },
      });
    }

    // Calcular valor sem features extras
    // Calcular valor dos módulos extras (após remoção)
    const remainingFeatures = await this.prisma.subscriptionFeature.findMany({
      where: { subscriptionId, isActive: true },
    });
    const modulesValue = remainingFeatures.reduce(
      (sum, sf) => sum + (sf.price || 0),
      0,
    );
    const newValue =
      (subscription.plan.basePrice +
        modulesValue +
        (subscription.plan.additionalUserPrice || 0) *
          (subscription.additionalUsers || 0)) /
      100;

    // Atualizar subscription no Asaas
    try {
      await this.updateAsaasSubscription(subscription.asaasSubscriptionId, {
        value: newValue,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to update subscription in Asaas: ${error.message}`,
      );
    }

    // Atualizar subscription local
    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        // modules array foi removido - agora usar subscriptionFeatures
        value: newValue,
      },
      include: {
        plan: true,
        customer: true,
      },
    });

    // Registrar no histórico
    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId,
        action: 'MODULE_REMOVED',
        description: `Módulo ${subscriptionFeature?.feature?.name || moduleId} removido`,
        changes: {
          before: { value: subscription.value, moduleKey: moduleId },
          after: { value: newValue },
        },
        metadata: {
          featureId: subscriptionFeature?.featureId,
          featureKey: moduleId,
        },
        createdByName: request.user?.name || 'Sistema',
      },
    });

    return updated;
  }

  async extendTrialPeriod(
    subscriptionId: string,
    password: string,
    adminUserId: string,
  ) {
    // Validar senha do administrador
    const adminUser = await this.prisma.user.findFirst({
      where: { id: adminUserId },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Usuário administrador não encontrado.');
    }

    const isPasswordValid = await argon2.verify(adminUser.password, password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha do administrador incorreta.');
    }

    // Buscar a subscription
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        Company: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription não encontrada.');
    }

    // Verificar se é uma subscription TRIAL
    if (subscription.plan.planType !== 'TRIAL') {
      throw new BadRequestException(
        'Apenas subscriptions TRIAL podem ter o período estendido.',
      );
    }

    // Calcular nova data: hoje + 7 dias
    const now = new Date();
    const newDueDate = new Date(now);
    newDueDate.setDate(newDueDate.getDate() + TRIAL_DAYS_DEFAULT);

    // Atualizar a subscription
    const updatedSubscription = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        nextDueDate: newDueDate,
      },
      include: {
        plan: true,
        Company: true,
        customer: true,
      },
    });

    this.logger.log(
      `Período trial estendido para ${subscription.Company?.name} pelo admin ${adminUser.name}. Novo vencimento: ${newDueDate.toISOString()}`,
    );

    // Registrar no histórico
    await this.prisma.subscriptionHistory.create({
      data: {
        subscriptionId,
        action: 'TRIAL_EXTENDED',
        description: `Período trial estendido pelo admin ${adminUser.name}`,
        changes: {
          before: { nextDueDate: subscription.nextDueDate },
          after: { nextDueDate: newDueDate },
        },
        metadata: {
          adminUserId,
          adminName: adminUser.name,
          companyName: subscription.Company?.name,
        },
        createdByName: adminUser.name,
      },
    });

    return {
      message: 'Período trial estendido com sucesso.',
      subscription: updatedSubscription,
      previousDueDate: subscription.nextDueDate,
      newDueDate,
    };
  }

  async assignManual(assignDto: AssignSubscriptionDto, adminUserId: string) {
    // Validar senha do administrador
    const adminUser = await this.prisma.user.findFirst({
      where: { id: adminUserId },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Usuário administrador não encontrado.');
    }

    const isPasswordValid = await argon2.verify(
      adminUser.password,
      assignDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha do administrador incorreta.');
    }

    // Verificar se a empresa existe
    const company = await this.prisma.company.findUnique({
      where: { id: assignDto.companyId },
      include: {
        customer: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    // Buscar o plano START automaticamente
    const plan = await this.prisma.plan.findFirst({
      where: { planType: 'START' },
    });

    if (!plan) {
      throw new NotFoundException('Plano START não encontrado no sistema.');
    }

    // Calcular valor base do plano (sem features ou usuários adicionais)
    const totalValue = plan.basePrice / 100;

    // Verificar se já existe subscription ativa para a empresa
    const existingSubscription = await this.prisma.subscription.findFirst({
      where: {
        companyId: assignDto.companyId,
        status: 'ACTIVE',
      },
    });

    if (existingSubscription) {
      // Desativar subscription anterior
      await this.prisma.subscription.update({
        where: { id: existingSubscription.id },
        data: { status: 'INACTIVE' },
      });
      this.logger.log(
        `Subscription anterior ${existingSubscription.id} desativada`,
      );
    }

    // Buscar ou criar customer
    let customer;
    if (company.customer && company.customer.length > 0) {
      customer = company.customer[0];
      this.logger.log(`Customer existente encontrado: ${customer.id}`);
    } else {
      // Criar customer básico se não existir
      const user = await this.prisma.user.findFirst({
        where: {
          employee: {
            some: {
              companyId: assignDto.companyId,
            },
          },
        },
      });

      customer = await this.prisma.customer.create({
        data: {
          name: company.name || company.legalName,
          email: company.email || user?.email || 'sem-email@temp.com',
          document: company.cnpj || `temp_${company.id}`,
          asaasCustomerId: `manual_${uuidv4()}`,
          companyId: company.id,
        },
      });
      this.logger.log(`Customer criado: ${customer.id}`);
    }

    // Criar subscription manualmente (sem passar pelo Asaas)
    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + TRIAL_DAYS_DEFAULT);

    const subscription = await this.prisma.subscription.create({
      data: {
        customerId: customer.id,
        planId: plan.id,
        companyId: assignDto.companyId,
        additionalUsers: 0,
        asaasSubscriptionId: `manual_${uuidv4()}`, // ID manual, não vem do Asaas
        nextDueDate,
        cycle: 'MONTHLY',
        billingType: 'CREDIT_CARD',
        value: totalValue,
        status: 'ACTIVE', // Ativar imediatamente
      },
    });

    this.logger.log(
      `Subscription START atribuída manualmente: ${subscription.id} para empresa ${company.name}`,
    );

    return {
      message: 'Plano START atribuído com sucesso à empresa.',
      subscription: await this.prisma.subscription.findUnique({
        where: { id: subscription.id },
        include: {
          plan: true,
          customer: true,
        },
      }),
    };
  }

  private async cancelAsaasSubscription(
    asaasSubscriptionId: string,
  ): Promise<void> {
    const route = `/subscriptions/${asaasSubscriptionId}`;

    try {
      await this.asaasApi().delete(route);
    } catch (error) {
      this.logger.error(
        `Error canceling Asaas subscription: ${JSON.stringify(error.response?.data || error.message)}`,
      );
      throw new Error('Failed to cancel subscription in Asaas');
    }
  }

  private async updateAsaasSubscription(
    asaasSubscriptionId: string,
    data: AsaasUpdateSubscriptionPayload,
  ): Promise<AsaasSubscriptionResponse> {
    const route = `/subscriptions/${asaasSubscriptionId}`;

    try {
      const response = await this.asaasApi().post(route, data);
      return response.data;
    } catch (error) {
      const errorResponse = error.response?.data.errors;
      const errorDescription = errorResponse
        ?.map((err) => err.description)
        .join(', ');

      this.logger.error(
        'Error updating Asaas subscription:',
        JSON.stringify({
          message: error.message,
          response: errorResponse,
          status: error.response?.status,
          route,
          data,
        }),
      );
      throw new Error(
        errorDescription ||
          error.message ||
          'Falha ao atualizar assinatura no Asaas',
      );
    }
  }

  private async createSubscription(
    subscriptionData: AsaasCreateSubscriptionPayload,
  ): Promise<AsaasSubscriptionResponse> {
    const route = '/subscriptions';
    this.logger.debug(`payload asaas: ${JSON.stringify(subscriptionData)}`);
    try {
      const response = await this.asaasApi().post(route, subscriptionData);
      return response.data;
    } catch (error) {
      const errorResponse = error.response?.data.errors;
      const errorDescription = errorResponse
        ?.map((err) => err.description)
        .join(', ');

      this.logger.error(
        'Erro ao criar assinatura no Asaas:',
        JSON.stringify({
          message: error.message,
          response: errorResponse,
          status: error.response?.status,
          route,
          data: subscriptionData,
        }),
      );
      throw new Error(
        errorDescription ||
          error.message ||
          'Falha ao criar assinatura no Asaas',
      );
    }
  }

  /**
   * Busca os pagamentos de uma subscription no Asaas
   */
  async getAsaasSubscriptionPayments(
    asaasSubscriptionId: string,
  ): Promise<any[]> {
    const route = `/subscriptions/${asaasSubscriptionId}/payments`;

    try {
      const response = await this.asaasApi().get(route);
      return response.data.data || [];
    } catch (error) {
      this.logger.error('Erro ao buscar payments da subscription no Asaas:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw new Error(
        `Falha ao buscar cobranças da assinatura no Asaas: ${error.message}`,
      );
    }
  }

  /**
   * Verifica o status da subscription no Asaas sem fazer alterações
   * Útil para verificar antes de sincronizar manualmente
   */
  async checkAsaasStatus(companyId: string) {
    this.logger.log(
      `Verificando status no Asaas para empresa ${companyId} (apenas leitura)`,
    );

    // Buscar a subscription mais recente da empresa que não seja TRIAL
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        plan: {
          planType: {
            not: 'TRIAL',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        plan: true,
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!subscription) {
      return {
        found: false,
        message: 'Nenhuma subscription encontrada para esta empresa',
      };
    }

    // Se o ID começa com "manual_", não tem vínculo com Asaas
    if (subscription.asaasSubscriptionId?.startsWith('manual_')) {
      return {
        found: true,
        hasAsaasLink: false,
        message:
          'Esta subscription foi criada manualmente e não tem vínculo com Asaas',
        localStatus: subscription.status,
        subscription: {
          id: subscription.id,
          plan: subscription.plan?.name,
        },
      };
    }

    try {
      // Buscar os pagamentos da subscription no Asaas
      this.logger.log(
        `Buscando pagamentos no Asaas para subscription ID: ${subscription.asaasSubscriptionId}`,
      );

      const asaasPayments = await this.getAsaasSubscriptionPayments(
        subscription.asaasSubscriptionId,
      );

      if (!asaasPayments || asaasPayments.length === 0) {
        return {
          found: true,
          hasAsaasLink: true,
          hasPendingSync: false,
          message: 'Nenhum pagamento encontrado no Asaas',
          localStatus: subscription.status,
          asaasSubscriptionId: subscription.asaasSubscriptionId,
          subscription: {
            id: subscription.id,
            plan: subscription.plan?.name,
          },
        };
      }

      // Encontrar o pagamento mais relevante:
      // PRIORIDADE para detectar inadimplência:
      // 1. Pagamento OVERDUE (vencido e não pago) - indica inadimplência
      // 2. Pagamento PENDING com vencimento passado - possível atraso
      // 3. Pagamento confirmado/recebido - cliente em dia
      // 4. Primeiro da lista como fallback
      const today = new Date().toISOString().split('T')[0];

      // Verificar inadimplência primeiro
      const overduePayment = asaasPayments.find((p) => p.status === 'OVERDUE');

      // Pagamento pendente com vencimento passado (possível atraso)
      const pendingOverduePayment = asaasPayments.find(
        (p) => p.status === 'PENDING' && p.dueDate < today,
      );

      // Pagamento confirmado/recebido
      const confirmedPayment = asaasPayments.find(
        (p) =>
          p.status === 'CONFIRMED' ||
          p.status === 'RECEIVED' ||
          p.status === 'RECEIVED_IN_CASH',
      );

      // Prioridade: OVERDUE > PENDING vencido > CONFIRMED > primeiro
      const relevantPayment =
        overduePayment ||
        pendingOverduePayment ||
        confirmedPayment ||
        asaasPayments[0];

      // Determinar se há inadimplência
      const hasOverduePayment = !!(overduePayment || pendingOverduePayment);

      this.logger.log(
        `Resposta Asaas - Total de pagamentos: ${asaasPayments.length}`,
      );
      this.logger.log(
        `Inadimplência detectada: ${hasOverduePayment ? 'SIM' : 'NÃO'}`,
      );
      this.logger.log(
        `Pagamento relevante: ${JSON.stringify({
          id: relevantPayment.id,
          status: relevantPayment.status,
          value: relevantPayment.value,
          dueDate: relevantPayment.dueDate,
          paymentDate: relevantPayment.paymentDate,
        })}`,
      );

      // Verificar se o pagamento foi confirmado ou recebido no Asaas
      const isPaymentConfirmed =
        relevantPayment.status === 'CONFIRMED' ||
        relevantPayment.status === 'RECEIVED' ||
        relevantPayment.status === 'RECEIVED_IN_CASH';

      // Só permite sincronização se NÃO houver inadimplência E pagamento confirmado
      const hasPendingSync =
        isPaymentConfirmed &&
        !hasOverduePayment &&
        subscription.status !== 'ACTIVE';

      // Determinar mensagem apropriada baseada nos status
      let message: string;
      if (hasOverduePayment) {
        message = 'Cliente inadimplente! Há pagamento vencido ou em atraso.';
      } else if (hasPendingSync) {
        message =
          'Pagamento confirmado no Asaas! A subscription local pode ser ativada.';
      } else if (subscription.status === 'ACTIVE' && isPaymentConfirmed) {
        message = 'Tudo certo! Subscription ativa e pagamento confirmado.';
      } else if (relevantPayment.status === 'PENDING') {
        message = 'Aguardando pagamento no Asaas.';
      } else {
        message = `Status do pagamento no Asaas: ${relevantPayment.status}`;
      }

      return {
        found: true,
        hasAsaasLink: true,
        hasPendingSync,
        message,
        localStatus: subscription.status,
        asaasPaymentStatus: relevantPayment.status,
        asaasPaymentId: relevantPayment.id,
        subscription: {
          id: subscription.id,
          plan: subscription.plan?.name,
        },
      };
    } catch (error) {
      this.logger.error(
        `Erro ao verificar status no Asaas: ${error.message}`,
        error,
      );
      throw new BadRequestException(
        `Erro ao verificar status no Asaas: ${error.message}`,
      );
    }
  }

  /**
   * Verifica o status da subscription e sincroniza com o Asaas
   * Útil para quando o webhook não é disparado (ex: sandbox)
   */
  async checkAndSyncSubscriptionStatus(companyId: string) {
    if (!companyId) {
      this.logger.warn(
        'Tentativa de sincronizar subscription com companyId nulo',
      );
      return { success: false, message: 'ID da empresa não informado' };
    }

    this.logger.log(
      `Verificando status da subscription para empresa ${companyId}`,
    );

    // Buscar a subscription mais recente da empresa que não seja TRIAL
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        plan: {
          planType: {
            not: 'TRIAL',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        payments: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
        plan: {
          include: {
            planFeatures: {
              include: {
                feature: true,
              },
            },
            planLimits: {
              include: {
                limit: true,
              },
            },
          },
        },
      },
    });

    if (!subscription) {
      this.logger.warn(
        `Nenhuma subscription encontrada para empresa ${companyId}`,
      );
      return { status: 'not_found', subscription: null };
    }

    // Se já está ativa, não precisa verificar
    if (subscription.status === 'ACTIVE') {
      return { status: 'already_active', subscription };
    }

    // TODO: Cenário de risco identificado - Se um admin desativar manualmente uma conta
    // (por fraude, abuso, etc.) e o cliente tiver pagamento confirmado no Asaas,
    // essa função irá reativar a conta no próximo login.
    // Possíveis soluções:
    // 1. Criar campo `blockedFromAutoActivation` na subscription
    // 2. Verificar histórico se última ação foi desativação manual
    // 3. Só ativar subscriptions criadas recentemente (últimos 30 dias)

    try {
      // Buscar os pagamentos da subscription no Asaas
      const asaasPayments = await this.getAsaasSubscriptionPayments(
        subscription.asaasSubscriptionId,
      );

      if (!asaasPayments || asaasPayments.length === 0) {
        this.logger.warn(
          `Nenhum pagamento encontrado no Asaas para subscription ${subscription.asaasSubscriptionId}`,
        );
        return { status: 'no_payments', subscription };
      }

      // Encontrar o pagamento mais relevante do período atual:
      // Apenas pagamentos com dueDate no mês atual ou posterior são considerados válidos
      const currentMonthStart = new Date();
      currentMonthStart.setDate(1);
      currentMonthStart.setHours(0, 0, 0, 0);
      const currentMonthStr = currentMonthStart.toISOString().split('T')[0];

      const confirmedPayment = asaasPayments.find(
        (p) =>
          (p.status === 'CONFIRMED' ||
            p.status === 'RECEIVED' ||
            p.status === 'RECEIVED_IN_CASH') &&
          p.dueDate >= currentMonthStr,
      );

      // Priorizar pagamento confirmado do período atual, senão pegar o primeiro
      const latestPayment = confirmedPayment || asaasPayments[0];

      this.logger.log(
        `Cobranças encontradas: ${asaasPayments.length}, Paga: ${confirmedPayment ? 'SIM' : 'NÃO'}`,
      );
      this.logger.log(
        `Status do pagamento selecionado: ${latestPayment.status} (${latestPayment.id})`,
      );

      // Verificar se o pagamento foi confirmado ou recebido no Asaas
      const isPaymentConfirmed =
        latestPayment.status === 'CONFIRMED' ||
        latestPayment.status === 'RECEIVED' ||
        latestPayment.status === 'RECEIVED_IN_CASH';

      // Verificar se há inadimplência (pagamento vencido não pago)
      const today = new Date().toISOString().split('T')[0];
      const overduePayment = asaasPayments.find((p) => p.status === 'OVERDUE');
      const pendingOverduePayment = asaasPayments.find(
        (p) => p.status === 'PENDING' && p.dueDate < today,
      );
      const hasOverduePayment = !!(overduePayment || pendingOverduePayment);

      if (hasOverduePayment) {
        this.logger.warn(
          `Cliente inadimplente! Não será ativado. Pagamento vencido: ${(overduePayment || pendingOverduePayment)?.id}`,
        );
        return {
          status: 'overdue',
          subscription,
          message:
            'Cliente possui pagamento vencido. Não pode ser ativado automaticamente.',
        };
      }

      if (isPaymentConfirmed) {
        this.logger.log(
          `Pagamento confirmado no Asaas! Ativando subscription ${subscription.id}`,
        );

        // Atualizar o payment local
        const localPayment = subscription.payments[0];
        if (localPayment) {
          await this.prisma.payment.update({
            where: { id: localPayment.id },
            data: {
              status: 'CONFIRMED',
              confirmedDate: new Date(),
              paymentDate: latestPayment.paymentDate
                ? new Date(latestPayment.paymentDate)
                : new Date(),
            },
          });

          this.logger.log(
            `Payment ${localPayment.id} atualizado para CONFIRMED`,
          );
        }

        // Verificar se existe subscription TRIAL ativa da mesma empresa
        const trialSubscription = await this.prisma.subscription.findFirst({
          where: {
            companyId: subscription.companyId,
            status: 'ACTIVE',
            plan: {
              planType: 'TRIAL',
            },
          },
        });

        // Desativar subscription TRIAL se existir
        if (trialSubscription) {
          await this.prisma.subscription.update({
            where: { id: trialSubscription.id },
            data: { status: 'INACTIVE' },
          });

          this.logger.log(
            `Subscription TRIAL ${trialSubscription.id} desativada automaticamente`,
          );

          // Registrar no histórico
          await this.prisma.subscriptionHistory.create({
            data: {
              subscriptionId: trialSubscription.id,
              action: 'DEACTIVATED',
              description: 'Trial desativado após ativação de plano pago',
              changes: {
                before: { status: 'ACTIVE' },
                after: { status: 'INACTIVE' },
              },
              metadata: {
                reason: 'Nova subscription ativada via sincronização',
                newSubscriptionId: subscription.id,
              },
              createdByName: 'Sistema - Sincronização',
            },
          });
        }

        // Ativar a subscription
        const updatedSubscription = await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            nextDueDate: latestPayment.dueDate
              ? new Date(latestPayment.dueDate)
              : subscription.nextDueDate,
          },
          include: {
            plan: {
              include: {
                planFeatures: {
                  include: {
                    feature: true,
                  },
                },
                planLimits: {
                  include: {
                    limit: true,
                  },
                },
              },
            },
          },
        });

        // Desbloquear a empresa (limpar blockLevel/isActive)
        const company = await this.prisma.company.findUnique({
          where: { id: companyId },
          select: { blockLevel: true, isActive: true, blockedAt: true },
        });

        if (
          company &&
          (company.blockLevel !== 'NONE' || company.isActive === false)
        ) {
          await this.prisma.company.update({
            where: { id: companyId },
            data: {
              blockLevel: 'NONE',
              isActive: true,
              blockedAt: null,
            },
          });

          this.logger.log(
            `Company ${companyId} desbloqueada: blockLevel → NONE, isActive → true`,
          );

          // Registrar no histórico da empresa
          await this.prisma.companyHistory.create({
            data: {
              companyId,
              action: 'UNBLOCKED',
              description:
                'Empresa desbloqueada automaticamente após confirmação de pagamento',
              changes: {
                before: {
                  blockLevel: company.blockLevel,
                  isActive: company.isActive,
                },
                after: { blockLevel: 'NONE', isActive: true },
              },
              createdByName: 'Sistema - Sincronização',
            },
          });
        }
        // Registrar no histórico
        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            action: 'ACTIVATED',
            description: 'Conta ativada após sincronização com Asaas',
            changes: {
              before: { status: 'INACTIVE' },
              after: { status: 'ACTIVE' },
            },
            metadata: {
              reason: 'Pagamento confirmado via sincronização',
              paymentId: latestPayment.id,
            },
            createdByName: 'Sistema - Sincronização',
          },
        });

        return {
          status: 'activated',
          subscription: updatedSubscription,
          payment: latestPayment,
        };
      } else {
        this.logger.log(
          `Pagamento ainda pendente no Asaas: ${latestPayment.status}`,
        );
        return {
          status: 'payment_pending',
          subscription,
          payment: latestPayment,
        };
      }
    } catch (error) {
      this.logger.error(
        `Erro ao verificar status da subscription: ${error.message}`,
        error,
      );
      throw new BadRequestException(
        `Erro ao verificar status: ${error.message}`,
      );
    }
  }

  /**
   * Atualiza dados de um cliente ativo (empresa, endereço e usuário)
   */
  async updateActiveClient(
    companyId: string,
    updateDto: UpdateActiveClientDto,
    userId: string,
  ) {
    // Buscar a empresa
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        address: {
          where: { type: 'Principal' },
          take: 1,
        },
        customer: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada');
    }

    // Buscar o usuário que está realizando a alteração
    const adminUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    // Verificar a senha do administrador
    const isPasswordValid = await argon2.verify(
      adminUser.password,
      updateDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha incorreta');
    }

    // Buscar o employee/user principal da empresa
    const employee = await this.prisma.employee.findFirst({
      where: {
        companyId: company.id,
        userId: { not: null },
      },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    // Verificar se o email está sendo alterado e se já existe outro registro com esse email
    if (updateDto.email && employee?.user) {
      const currentEmail = employee.user.email;
      if (currentEmail !== updateDto.email) {
        // Email está sendo alterado, verifica duplicação na tabela User
        const existingUser = await this.prisma.user.findFirst({
          where: {
            email: updateDto.email,
            id: { not: employee.user.id },
          },
        });
        if (existingUser) {
          throw new ConflictException('E-mail já cadastrado.');
        }

        // Verifica duplicação na tabela Customer
        if (company.customer && company.customer.length > 0) {
          const existingCustomer = await this.prisma.customer.findFirst({
            where: {
              email: updateDto.email,
              id: { not: company.customer[0].id },
            },
          });
          if (existingCustomer) {
            throw new ConflictException('E-mail já cadastrado.');
          }
        }
      }
    }

    // Preparar dados para atualização
    const changes: any = {
      before: {
        companyName: company.legalName || company.name,
        document: company.cnpj,
        state: company.address[0]?.state,
        city: company.address[0]?.city,
        userName: employee?.user?.name,
        userDocument: employee?.cpf,
        email: employee?.user?.email || company.email,
        phone: employee?.user?.phone || company.phone || company.mobile,
      },
      after: {},
    };

    // Atualizar a empresa
    const companyUpdateData: any = {};
    if (updateDto.companyName) {
      companyUpdateData.legalName = updateDto.companyName;
      companyUpdateData.name = updateDto.companyName;
      changes.after.companyName = updateDto.companyName;
    }
    if (updateDto.document) {
      companyUpdateData.cnpj = updateDto.document;
      changes.after.document = updateDto.document;
    }

    // Atualizar empresa se houver alterações
    if (Object.keys(companyUpdateData).length > 0) {
      await this.prisma.company.update({
        where: { id: companyId },
        data: companyUpdateData,
      });
    }

    // Atualizar endereço
    if (updateDto.stateId || updateDto.cityId) {
      const address = company.address[0];
      if (address) {
        await this.prisma.address.update({
          where: { id: address.id },
          data: {
            state: updateDto.stateId || address.state,
            city: updateDto.cityId || address.city,
          },
        });
        if (updateDto.stateId) changes.after.state = updateDto.stateId;
        if (updateDto.cityId) changes.after.city = updateDto.cityId;
      }
    }

    // Atualizar usuário
    if (employee?.user) {
      const userUpdateData: any = {};
      if (updateDto.userName) {
        userUpdateData.name = updateDto.userName;
        changes.after.userName = updateDto.userName;
      }
      if (updateDto.email) {
        userUpdateData.email = updateDto.email;
        changes.after.email = updateDto.email;
      }
      if (updateDto.phone) {
        userUpdateData.phone = updateDto.phone;
        changes.after.phone = updateDto.phone;
      }

      if (Object.keys(userUpdateData).length > 0) {
        await this.prisma.user.update({
          where: { id: employee.user.id },
          data: userUpdateData,
        });
      }

      // Atualizar employee (CPF)
      if (updateDto.userDocument) {
        await this.prisma.employee.update({
          where: { id: employee.id },
          data: { cpf: updateDto.userDocument },
        });
        changes.after.userDocument = updateDto.userDocument;
      }
    }

    // Atualizar customer (se existir)
    if (company.customer && company.customer.length > 0) {
      const customerUpdateData: any = {};
      if (updateDto.userName) {
        customerUpdateData.name = updateDto.userName;
      }
      if (updateDto.email) {
        customerUpdateData.email = updateDto.email;
      }
      if (updateDto.userDocument) {
        customerUpdateData.document = updateDto.userDocument;
      }

      if (Object.keys(customerUpdateData).length > 0) {
        await this.prisma.customer.update({
          where: { id: company.customer[0].id },
          data: customerUpdateData,
        });
      }
    }

    // Atualizar status da subscription (se fornecido)
    if (updateDto.status) {
      const subscription = await this.prisma.subscription.findFirst({
        where: { companyId: company.id },
        orderBy: { createdAt: 'desc' },
      });

      if (subscription) {
        // Se está ativando uma subscription, desativar todas as outras ativas da mesma empresa
        if (updateDto.status === 'ACTIVE') {
          const otherActiveSubscriptions =
            await this.prisma.subscription.findMany({
              where: {
                companyId: company.id,
                status: 'ACTIVE',
                id: { not: subscription.id },
              },
            });

          for (const otherSubscription of otherActiveSubscriptions) {
            await this.prisma.subscription.update({
              where: { id: otherSubscription.id },
              data: { status: 'INACTIVE' },
            });

            // Criar histórico para cada subscription desativada
            await this.prisma.subscriptionHistory.create({
              data: {
                subscriptionId: otherSubscription.id,
                action: 'DEACTIVATED',
                description:
                  'Subscription desativada automaticamente ao ativar outra',
                changes: {
                  before: { status: 'ACTIVE' },
                  after: { status: 'INACTIVE' },
                },
                metadata: {
                  reason: 'Nova subscription ativada manualmente',
                  newSubscriptionId: subscription.id,
                  changedBy: adminUser.name,
                  changedAt: new Date().toISOString(),
                },
                createdBy: userId,
                createdByName: adminUser.name,
              },
            });

            this.logger.log(
              `Subscription ${otherSubscription.id} desativada automaticamente ao ativar ${subscription.id}`,
            );
          }
        }

        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: updateDto.status },
        });
        changes.after.status = updateDto.status;

        // Criar histórico da subscription
        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            action: 'STATUS_CHANGE',
            description: `Status alterado para ${updateDto.status}`,
            metadata: {
              previousStatus: subscription.status,
              newStatus: updateDto.status,
              changedBy: adminUser.name,
              changedAt: new Date().toISOString(),
            },
            createdBy: userId,
            createdByName: adminUser.name,
          },
        });

        // Sincronizar blockLevel e isActive na empresa conforme novo status
        if (updateDto.status === 'BLOCKED') {
          await this.prisma.company.update({
            where: { id: companyId },
            data: {
              blockLevel: 'PARTIAL',
              blockedAt: new Date(),
              blockReason: `Bloqueio manual por ${adminUser.name}`,
            },
          });
        } else if (updateDto.status === 'INACTIVE') {
          await this.prisma.company.update({
            where: { id: companyId },
            data: {
              blockLevel: 'FULL',
              isActive: false,
              blockedAt: new Date(),
              blockReason: `Inativação manual por ${adminUser.name}`,
            },
          });
        } else if (updateDto.status === 'ACTIVE') {
          await this.prisma.company.update({
            where: { id: companyId },
            data: {
              blockLevel: 'NONE',
              blockedAt: null,
              blockReason: null,
              isActive: true,
            },
          });
        }
      }
    }

    // Criar histórico da empresa
    await this.prisma.companyHistory.create({
      data: {
        companyId: company.id,
        action: 'UPDATE',
        description: 'Dados da empresa atualizados via painel administrativo',
        changes,
        metadata: {
          updatedBy: adminUser.name,
          updatedAt: new Date().toISOString(),
        },
        createdBy: userId,
        createdByName: adminUser.name,
      },
    });

    return {
      message: 'Cliente atualizado com sucesso',
    };
  }

  /**
   * Mapeia status do payment do Asaas para nosso enum
   */
  private mapAsaasPaymentStatus(asaasStatus: string): string {
    const statusMap: Record<string, string> = {
      PENDING: 'PENDING',
      CONFIRMED: 'CONFIRMED',
      RECEIVED: 'RECEIVED',
      RECEIVED_IN_CASH: 'RECEIVED',
      OVERDUE: 'OVERDUE',
      REFUNDED: 'REFUNDED',
      REFUND_REQUESTED: 'REFUNDED',
      CHARGEBACK_REQUESTED: 'REFUNDED',
      CHARGEBACK_DISPUTE: 'REFUNDED',
      AWAITING_CHARGEBACK_REVERSAL: 'REFUNDED',
      DUNNING_REQUESTED: 'OVERDUE',
      DUNNING_RECEIVED: 'RECEIVED',
      AWAITING_RISK_ANALYSIS: 'PENDING',
    };

    return statusMap[asaasStatus] || 'PENDING';
  }

  /**
   * Exclui uma conta (empresa) completamente do sistema.
   * Remove todos os dados relacionados de forma permanente.
   * Requer senha do administrador para confirmação.
   */
  async deleteCompany(
    companyId: string,
    password: string,
    adminUserId: string,
  ) {
    // Validar senha do administrador
    const adminUser = await this.prisma.user.findFirst({
      where: { id: adminUserId },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Usuário administrador não encontrado.');
    }

    const isPasswordValid = await argon2.verify(adminUser.password, password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha do administrador incorreta.');
    }

    // Verificar se a empresa existe
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        Subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    const companyName = company.name;

    // Buscar IDs dos usuários relacionados à empresa (via Employee)
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: { userId: true },
    });
    const userIds = employees
      .filter((e) => e.userId !== null)
      .map((e) => e.userId as string);

    // Buscar customer IDs das subscriptions
    const subscriptions = await this.prisma.subscription.findMany({
      where: { companyId },
      select: { id: true, customerId: true, asaasSubscriptionId: true },
    });
    const subscriptionIds = subscriptions.map((s) => s.id);
    const customerIds = [...new Set(subscriptions.map((s) => s.customerId))];

    this.logger.log(
      `Iniciando exclusão da empresa ${companyName} (${companyId}) pelo admin ${adminUser.name}`,
    );

    // Cancelar subscriptions no Asaas ANTES de deletar do banco
    for (const sub of subscriptions) {
      if (sub.asaasSubscriptionId) {
        try {
          await this.cancelAsaasSubscription(sub.asaasSubscriptionId);
          this.logger.log(
            `Subscription Asaas ${sub.asaasSubscriptionId} cancelada para empresa ${companyId}`,
          );
        } catch (error) {
          this.logger.warn(
            `Falha ao cancelar subscription Asaas ${sub.asaasSubscriptionId}: ${error.message}`,
          );
          // Continuar com a exclusão mesmo se falhar no Asaas
        }
      }
    }

    // Audit trail: registrar snapshot da empresa antes da exclusão
    const deletionSnapshot = {
      companyName,
      companyId,
      subscriptionCount: subscriptions.length,
      planNames: company.Subscription?.map((s) => s.plan?.name).filter(Boolean),
      userCount: userIds.length,
      deletedBy: adminUser.name,
      deletedAt: new Date().toISOString(),
    };

    // Registrar histórico de exclusão para cada subscription
    for (const sub of subscriptions) {
      try {
        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: sub.id,
            action: 'COMPANY_DELETED',
            description: `Empresa ${companyName} excluída pelo admin ${adminUser.name}`,
            changes: { snapshot: deletionSnapshot },
            metadata: { adminUserId, adminName: adminUser.name },
            createdByName: adminUser.name,
          },
        });
      } catch {
        // Continuar mesmo se falhar o registro de histórico
      }
    }

    this.logger.log(
      `Audit trail registrado. Iniciando cascade delete para empresa ${companyName} (${companyId})`,
    );

    // Executar exclusão em cascata dentro de uma transação
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Fiscal - NF-e, NFS-e, NFC-e
        await tx.nfce.deleteMany({ where: { companyId } });
        await tx.nfse.deleteMany({ where: { companyId } });
        await tx.nfe.deleteMany({ where: { companyId } });
        await tx.invoicyConfig.deleteMany({ where: { companyId } });
        await tx.cfopConfig.deleteMany({ where: { companyId } });
        await tx.operationNature.deleteMany({ where: { companyId } });
        await tx.digitalCertificate.deleteMany({ where: { companyId } });

        // 2. Produção e Entregas
        await tx.productionStage.deleteMany({
          where: { schedule: { companyId } },
        });
        await tx.deliverySchedule.deleteMany({ where: { companyId } });
        await tx.orderHistory.deleteMany({
          where: { order: { quotation: { companyId } } },
        });
        await tx.order.deleteMany({
          where: { quotation: { companyId } },
        });
        await tx.deliveryInfo.deleteMany({
          where: { quotation: { companyId } },
        });

        // 3. Orçamentos
        await tx.quotationHistory.deleteMany({
          where: { quotation: { companyId } },
        });
        await tx.quotationInstallment.deleteMany({
          where: { quotationPayment: { quotation: { companyId } } },
        });
        await tx.quotationPayment.deleteMany({
          where: { quotation: { companyId } },
        });
        await tx.quotationProductItem.deleteMany({
          where: { quotationProduct: { quotation: { companyId } } },
        });
        await tx.quotationProduct.deleteMany({
          where: { quotation: { companyId } },
        });
        await tx.quotation.deleteMany({ where: { companyId } });

        // 4. Financeiro - Transactions, Payables, Receivables
        await tx.transaction.deleteMany({
          where: { cashRegister: { companyId } },
        });
        await tx.receivableHistory.deleteMany({
          where: { receivable: { companyId } },
        });
        await tx.receivableInstallment.deleteMany({
          where: { receivable: { companyId } },
        });
        await tx.receivable.deleteMany({ where: { companyId } });
        await tx.payableHistory.deleteMany({
          where: { payable: { companyId } },
        });
        await tx.payableInstallment.deleteMany({
          where: { payable: { companyId } },
        });
        await tx.commission.deleteMany({
          where: { supplier: { companyId } },
        });
        await tx.payable.deleteMany({ where: { companyId } });

        // 5. Cash Register
        await tx.bankAccountCashControl.deleteMany({
          where: { bankAccount: { companyId } },
        });
        await tx.cashRegister.deleteMany({ where: { companyId } });

        // 6. Clientes e Fornecedores
        await tx.clientPaymentCondition.deleteMany({
          where: { client: { companyId } },
        });
        await tx.supplierPaymentCondition.deleteMany({
          where: { supplier: { companyId } },
        });
        await tx.contact.deleteMany({
          where: {
            OR: [{ client: { companyId } }, { supplier: { companyId } }],
          },
        });
        await tx.address.deleteMany({
          where: {
            OR: [
              { companyId },
              { client: { companyId } },
              { supplier: { companyId } },
              { employee: { companyId } },
            ],
          },
        });
        await tx.client.deleteMany({ where: { companyId } });
        await tx.supplier.deleteMany({ where: { companyId } });

        // 7. Produtos
        await tx.productFiscalData.deleteMany({
          where: { product: { companyId } },
        });
        await tx.productItem.deleteMany({
          where: { product: { companyId } },
        });
        await tx.product.deleteMany({ where: { companyId } });

        // 8. Categorias e Naturezas
        await tx.subCategory.deleteMany({ where: { companyId } });
        await tx.nature.deleteMany({ where: { companyId } });
        await tx.category.deleteMany({ where: { companyId } });

        // 9. Despesas Agendadas
        await tx.scheduledExpense.deleteMany({ where: { companyId } });

        // 10. Financeiro extra
        await tx.financialFlow.deleteMany({ where: { companyId } });
        await tx.invoice.deleteMany({ where: { companyId } });
        await tx.creditLimitPaymentCondition.deleteMany({
          where: { creditLimitDefault: { companyId } },
        });
        await tx.creditLimitDefault.deleteMany({ where: { companyId } });

        // 11. Folha de Pagamento
        await tx.payrollItem.deleteMany({
          where: { payroll: { companyId } },
        });
        await tx.payroll.deleteMany({ where: { companyId } });
        await tx.payrollSetup.deleteMany({ where: { companyId } });
        await tx.payrollTemplate.deleteMany({ where: { companyId } });

        // 12. Funcionários
        await tx.employeeHistory.deleteMany({
          where: { employee: { companyId } },
        });
        await tx.employee.deleteMany({ where: { companyId } });

        // 13. Ativos
        await tx.asset.deleteMany({ where: { companyId } });
        await tx.assetType.deleteMany({ where: { companyId } });

        // 14. Configurações Bancárias
        await tx.installment.deleteMany({
          where: { paymentCondition: { companyId } },
        });
        await tx.paymentCondition.deleteMany({ where: { companyId } });
        await tx.bankAccount.deleteMany({ where: { companyId } });

        // 15. Séries e Tags
        await tx.saleSeries.deleteMany({ where: { companyId } });
        await tx.quotationTag.deleteMany({ where: { companyId } });

        // 16. Perfis e Cargos
        await tx.sellerProfile.deleteMany({ where: { companyId } });
        await tx.userRole.deleteMany({
          where: { role: { companyId } },
        });
        await tx.role.deleteMany({ where: { companyId } });
        await tx.companySector.deleteMany({ where: { companyId } });

        // 17. Academy
        await tx.academyProgress.deleteMany({ where: { companyId } });

        // 18. Motivos
        await tx.reasons.deleteMany({ where: { companyId } });

        // 19. Idiomas
        await tx.language.deleteMany({ where: { companyId } });

        // 20. Import Logs
        await tx.importLog.deleteMany({ where: { companyId } });

        // 21. Subscription relacionados
        await tx.subscriptionFeature.deleteMany({
          where: { subscriptionId: { in: subscriptionIds } },
        });
        await tx.subscriptionHistory.deleteMany({
          where: { subscriptionId: { in: subscriptionIds } },
        });
        await tx.payment.deleteMany({
          where: { subscriptionId: { in: subscriptionIds } },
        });
        await tx.subscription.deleteMany({ where: { companyId } });

        // 22. Company History
        await tx.companyHistory.deleteMany({ where: { companyId } });

        // 22.1 User Activity (para esta empresa especificamente, mesmo que o usuário permaneça)
        await tx.userActivity.deleteMany({ where: { companyId } });

        // 23. Company
        await tx.company.delete({ where: { id: companyId } });

        // 24. Customer (se não tiver outras subscriptions)
        for (const customerId of customerIds) {
          const otherSubscriptions = await tx.subscription.count({
            where: { customerId },
          });
          if (otherSubscriptions === 0) {
            await tx.customer.delete({ where: { id: customerId } });
          }
        }

        // 25. Usuários (se não tiverem vínculo com outras empresas)
        for (const userId of userIds) {
          const otherEmployees = await tx.employee.count({
            where: { userId },
          });
          if (otherEmployees === 0) {
            await tx.userActivity.deleteMany({ where: { userId } });
            await tx.userContract.deleteMany({ where: { userId } });
            await tx.userRole.deleteMany({ where: { userId } });
            await tx.user.delete({ where: { id: userId } });
          }
        }
      },
      {
        timeout: 60000, // 60 segundos para operações complexas
      },
    );

    this.logger.log(
      `Empresa ${companyName} (${companyId}) excluída com sucesso pelo admin ${adminUser.name}`,
    );

    return {
      message: `Conta "${companyName}" excluída permanentemente com sucesso.`,
      deletedCompanyId: companyId,
      deletedCompanyName: companyName,
    };
  }
}
