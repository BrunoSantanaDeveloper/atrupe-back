import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import axios from 'axios';
import { CustomersService } from '../customers/customers.service';
import { asaasConfig } from 'src/config/configuration';
import { v4 as uuidv4 } from 'uuid';
import * as argon2 from 'argon2';

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
  ) {
    const skip = (page - 1) * limit;

    // Mapear o campo de ordenação para o campo do Prisma
    const orderByField =
      sort === 'updated_at'
        ? 'updatedAt'
        : sort === 'created_at'
          ? 'createdAt'
          : 'name';

    // Buscar todos os registros de MailVerification
    const [mailVerifications, total] = await Promise.all([
      this.prisma.mailVerification.findMany({
        orderBy: {
          [orderByField]: orderByField === 'name' ? 'asc' : 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.mailVerification.count(),
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
    // Buscar todas as subscriptions TRIAL agrupadas por status
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        plan: {
          planType: 'TRIAL',
        },
      },
      select: {
        status: true,
      },
    });

    // Contar por status
    const totals = subscriptions.reduce(
      (acc, sub) => {
        acc[sub.status] = (acc[sub.status] || 0) + 1;
        acc.TOTAL += 1;
        return acc;
      },
      {
        ACTIVE: 0,
        INACTIVE: 0,
        DISCARDED: 0,
        TOTAL: 0,
      },
    );

    return {
      data: totals,
    };
  }

  async getActiveTotals() {
    // Buscar todas as subscriptions que NÃO são TRIAL agrupadas por status
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        plan: {
          planType: {
            not: 'TRIAL',
          },
        },
      },
      select: {
        status: true,
      },
    });

    // Contar por status
    const totals = subscriptions.reduce(
      (acc, sub) => {
        acc[sub.status] = (acc[sub.status] || 0) + 1;
        acc.TOTAL += 1;
        return acc;
      },
      {
        ACTIVE: 0,
        BLOCKED: 0,
        INACTIVE: 0,
        CANCELED: 0,
        TOTAL: 0,
      },
    );

    return {
      data: totals,
    };
  }

  async listActiveClients(
    page: number = 1,
    limit: number = 10,
    statusFilter?: string,
  ) {
    const skip = (page - 1) * limit;

    // Mapear o status em português para o enum do banco
    const statusMap: Record<string, string> = {
      ativas: 'ACTIVE',
      bloqueadas: 'BLOCKED',
      inativas: 'INACTIVE',
      canceladas: 'CANCELED',
    };

    const mappedStatus = statusFilter ? statusMap[statusFilter] : undefined;

    // Construir o where com filtro opcional de status (clientes que NÃO são TRIAL)
    const whereCondition: any = {
      plan: {
        planType: {
          not: 'TRIAL',
        },
      },
    };

    if (mappedStatus) {
      whereCondition.status = mappedStatus;
    }

    // Buscar subscriptions que não são TRIAL
    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
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
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.subscription.count({
        where: whereCondition,
      }),
    ]);

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

        // Período de assinatura: data de criação até nextDueDate
        const subscriptionStart = new Date(sub.createdAt);
        const nextDue = new Date(sub.nextDueDate);

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
          subscriptionPeriod: `${formatDate(subscriptionStart)} - ${formatDate(nextDue)}`,
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
            id: company.id,
            avatar: company.favIconUrl || undefined,
            companyName: company.legalName || company.name,
            code: `#${company.id.slice(0, 4).toUpperCase()}`,
            document: company.cnpj || '',
            userName: user?.name || 'N/A',
            phone: user?.phone || company.phone || company.mobile || '',
            email: user?.email || company.email || '',
            createdAt: item.subscription.createdAt,
            plan: item.subscription.plan.name,
            planType: item.subscription.plan.planType,
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

  async listTrialCompanies(
    page: number = 1,
    limit: number = 10,
    statusFilter?: string,
    sort: 'name' | 'updated_at' | 'created_at' = 'name',
  ) {
    const skip = (page - 1) * limit;

    // Mapear o status em português para o enum do banco
    const statusMap: Record<string, string> = {
      ativas: 'ACTIVE',
      inativas: 'INACTIVE',
      descartadas: 'DISCARDED',
    };

    const mappedStatus = statusFilter ? statusMap[statusFilter] : undefined;

    // Construir o where com filtro opcional de status
    const whereCondition: any = {
      plan: {
        planType: 'TRIAL',
      },
    };

    if (mappedStatus) {
      whereCondition.status = mappedStatus;
    }

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

    // Buscar subscriptions TRIAL
    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
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
        skip,
        take: limit,
      }),
      this.prisma.subscription.count({
        where: whereCondition,
      }),
    ]);

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

    // Verificar se já existe uma subscription ativa para a empresa
    const existingSubscription = await this.prisma.subscription.findFirst({
      where: {
        companyId: request.user.companyId,
        status: 'ACTIVE',
      },
      include: {
        plan: true,
        customer: true,
      },
    });

    // Se existe uma subscription e não é TRIAL, impede a criação
    if (
      existingSubscription &&
      existingSubscription.plan.planType !== 'TRIAL'
    ) {
      this.logger.error(
        'The company already has an active subscription. Use upgrade method instead.',
      );
      throw new BadRequestException(
        'Uma assinatura ativa já existe para esta empresa.',
      );
    }

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

    let finalCustomer: any;

    // Se existe uma subscription TRIAL, atualiza o customer existente
    if (
      existingSubscription &&
      existingSubscription.plan.planType === 'TRIAL'
    ) {
      this.logger.log(
        'Subscription TRIAL encontrada, atualizando customer existente',
      );

      // Preparar dados para atualização
      const customerUpdateData = {
        name: customer.name,
        email: customer.email,
        document: customer.document,
        phone: customer.phone,
        address: customer.address,
        addressNumber: customer.addressNumber,
        complement: customer.complement,
        province: customer.province,
        postalCode: customer.postalCode,
        city: customer.city,
        state: customer.state,
      };

      finalCustomer = await this.customerService.update(
        existingSubscription.customer.id,
        customerUpdateData,
      );

      // Desativar a subscription TRIAL antiga
      // Não desativar aqui, só desativar quando confirmar pagamento do novo plano
      // await this.prisma.subscription.update({
      //   where: { id: existingSubscription.id },
      //   data: { status: 'INACTIVE' },
      // });

      // this.logger.log('Subscription TRIAL desativada');
    } else {
      // Caso contrário, busca ou cria um novo customer
      const existingCustomer = await this.prisma.customer.findFirst({
        where: {
          companyId: createSubscriptionDto.companyId,
        },
      });

      if (existingCustomer) {
        this.logger.log('Cliente encontrado:', existingCustomer.name);
        finalCustomer = existingCustomer;
      } else {
        this.logger.log('customer not found, creating...');
        finalCustomer = await this.customerService.create(customer);
      }
    }

    // Soma o preço das features adicionais selecionadas
    const additionalFeaturesValue = additionalFeatures.reduce(
      (acc, feature) => acc + (feature.price || 0),
      0,
    );
    console.log('Valor total dos módulos adicionais:', additionalFeaturesValue);

    // Soma o preço da quantidade de usuários adicionais
    const additionalUsersValue =
      (plan.additionalUserPrice || 0) *
      (createSubscriptionDto.additionalUsers || 0);
    console.log('Valor total de usuários adicionais:', additionalUsersValue);

    const planPrice = plan.basePrice;
    console.log('Preço base do plano:', planPrice);

    // Soma o valor total a ser cobrado em centavos e divide por 100
    const value =
      (planPrice + additionalFeaturesValue + additionalUsersValue) / 100;
    console.log('Valor final:', value);

    try {
      // Primeiro criar a subscription no banco para obter o ID
      const subscription = await this.prisma.$transaction(async (tx) => {
        const newSubscription = await tx.subscription.create({
          data: {
            customerId: finalCustomer.id,
            planId: plan.id,
            companyId: request.user.companyId,
            additionalUsers: createSubscriptionDto.additionalUsers || 0,
            asaasSubscriptionId: `temp_${uuidv4()}`, // Temporário único, será atualizado após criação no Asaas
            nextDueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
            cycle: 'MONTHLY',
            billingType: createSubscriptionDto.billingType,
            value,
            status: 'INACTIVE', // Criar com status inativo, ativar somente após pagamento confirmado
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

    const featuresValue = 0; // Features extras via subscriptionFeatures

    // Calcular novo valor da subscription
    const newValue =
      newPlan.basePrice +
      featuresValue +
      (newPlan.additionalUserPrice || 0) *
        (currentSubscription.additionalUsers || 0);

    // Cancelar subscription atual no Asaas (se necessário)
    try {
      await this.cancelAsaasSubscription(
        currentSubscription.asaasSubscriptionId,
      );
    } catch (error) {
      console.warn(
        'Failed to cancel old subscription in Asaas:',
        error.message,
      );
    }

    // Criar nova subscription no Asaas
    const asaasData = {
      billingType: currentSubscription.billingType,
      cycle: currentSubscription.cycle,
      customer: currentSubscription.customer.asaasCustomerId,
      value: newValue,
      nextDueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
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

    const modulesValue = 0; // Features extras via subscriptionFeatures
    const newValue =
      plan.basePrice +
      modulesValue +
      (plan.additionalUserPrice || 0) * (subscription.additionalUsers || 0);

    // Atualizar subscription no Asaas
    try {
      await this.updateAsaasSubscription(subscription.asaasSubscriptionId, {
        value: newValue,
      });
    } catch (error) {
      console.warn('Failed to update subscription in Asaas:', error.message);
    }

    // Atualizar subscription local
    return this.prisma.subscription.update({
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
    const modulesValue = 0; // Features extras via subscriptionFeatures
    const newValue =
      subscription.plan.basePrice +
      modulesValue +
      (subscription.plan.additionalUserPrice || 0) *
        (subscription.additionalUsers || 0);

    // Atualizar subscription no Asaas
    try {
      await this.updateAsaasSubscription(subscription.asaasSubscriptionId, {
        value: newValue,
      });
    } catch (error) {
      console.warn('Failed to update subscription in Asaas:', error.message);
    }

    // Atualizar subscription local
    return this.prisma.subscription.update({
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
    nextDueDate.setDate(nextDueDate.getDate() + 30); // 30 dias

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
      console.error(
        'Error canceling Asaas subscription:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to cancel subscription in Asaas');
    }
  }

  private async updateAsaasSubscription(
    asaasSubscriptionId: string,
    data: any,
  ): Promise<any> {
    const route = `/subscriptions/${asaasSubscriptionId}`;

    try {
      const response = await this.asaasApi().post(route, data);
      return response.data;
    } catch (error) {
      const errorResponse = error.response?.data.errors;
      const errorDescription = errorResponse
        ?.map((err) => err.description)
        .join(', ');

      console.error('Error updating Asaas subscription:', {
        message: error.message,
        response: errorResponse,
        status: error.response?.status,
        route,
        data,
      });
      throw new Error(
        errorDescription ||
          error.message ||
          'Falha ao atualizar assinatura no Asaas',
      );
    }
  }

  private async createSubscription(subscriptionData: any): Promise<any> {
    const route = '/subscriptions';
    console.log('payload asaas:', subscriptionData);
    try {
      const response = await this.asaasApi().post(route, subscriptionData);
      return response.data;
    } catch (error) {
      const errorResponse = error.response?.data.errors;
      const errorDescription = errorResponse
        ?.map((err) => err.description)
        .join(', ');

      console.error('Erro ao criar assinatura no Asaas:', {
        message: error.message,
        response: errorResponse,
        status: error.response?.status,
        route,
        data: subscriptionData,
      });
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
  private async getAsaasSubscriptionPayments(
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
   * Mapeia status do payment do Asaas para nosso enum
   */
  private mapAsaasPaymentStatus(asaasStatus: string): any {
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
}
