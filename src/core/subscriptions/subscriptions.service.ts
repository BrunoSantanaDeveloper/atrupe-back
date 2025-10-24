import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import axios from 'axios';
import { CustomersService } from '../customers/customers.service';
import { PaymentsService } from '../payments/payments.service';
import { asaasConfig } from 'src/config/configuration';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private customerService: CustomersService,
    private paymentsService: PaymentsService,
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
      const updateData = {
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
        updateData,
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
        this.logger.log('Cliente encontrado:', existingCustomer);
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
        nextDueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
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

      // Criar primeira cobrança (payment)
      this.logger.log('Criando primeira cobrança para subscription');

      const firstPayment = await this.paymentsService.createFirstPayment({
        subscriptionId: subscription.id,
        asaasCustomerId: finalCustomer.asaasCustomerId,
        value,
        dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
          .toISOString()
          .split('T')[0],
        billingType: createSubscriptionDto.billingType,
        description: `Primeira cobrança - ${plan.name}`,
        successUrl: createSubscriptionDto.successUrl,
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
      throw new BadRequestException(
        `Failed to create subscription: ${error.message}`,
      );
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
   * Calcula o valor total das features extras de uma subscription
   */
  private async calculateSubscriptionFeaturesValue(
    subscriptionFeatures: any[],
  ): Promise<number> {
    return subscriptionFeatures.reduce(
      (total, sf) => total + (sf.price || 0),
      0,
    );
  }
}
