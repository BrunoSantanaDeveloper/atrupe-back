import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import axios from 'axios';
import { CustomersService } from '../customers/customers.service';
import { asaasConfig } from 'src/config/configuration';

@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private customerSerivce: CustomersService,
  ) {}
  private asaasToken = asaasConfig.token;
  private asaasApiUrl = asaasConfig.apiUrl;
  private isMockMode = asaasConfig.mockMode;

  async findActiveByCompanyId(companyId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: 'ACTIVE',
      },
      include: {
        plan: true,
        customer: true,
      },
    });
  }

  async create(createSubscriptionDto: CreateSubscriptionDto, request) {
    createSubscriptionDto.customer.userId = request.user.userId;
    createSubscriptionDto.customer.companyId = request.user.companyId;
    const { customer } = createSubscriptionDto;

    // Verificar se já existe uma subscription ativa para a empresa
    const existingActiveSubscription = await this.prisma.subscription.findFirst(
      {
        where: {
          companyId: request.user.companyId,
          status: 'ACTIVE',
        },
      },
    );

    if (existingActiveSubscription) {
      throw new BadRequestException(
        'Uma subscription ativa já existe para esta empresa. Use o método de upgrade para alterar o plano.',
      );
    }
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { document: customer.document },
    });

    // Get customer and plan from database
    const [plan, modules] = await Promise.all([
      this.prisma.plan.findUnique({
        where: { id: createSubscriptionDto.planId },
      }),
      this.prisma.module.findMany({
        where: { id: { in: createSubscriptionDto.modules } },
      }),
    ]);

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    let finalCustomer = existingCustomer;
    if (!existingCustomer) {
      console.log('customer not found, creating...');
      finalCustomer = await this.customerSerivce.create(customer);
    }
    // Calculate total value
    const modulesValue = modules.reduce((acc, module) => acc + module.price, 0);
    console.log('modulesValue', modulesValue);
    console.log('plan.basePrice', plan.basePrice);
    console.log('plan.additionalAccessPrice', plan.additionalAccessPrice);
    console.log(
      'createSubscriptionDto.additionalAccesses',
      createSubscriptionDto.additionalAccesses,
    );
    const value =
      plan.basePrice +
      modulesValue +
      plan.additionalAccessPrice * createSubscriptionDto.additionalAccesses;
    console.log('value', value);

    const data = {
      billingType: createSubscriptionDto.billingType,
      cycle: createSubscriptionDto.cycle,
      customer: finalCustomer.asaasCustomerId,
      value,
      nextDueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      description: `Assinatura ${plan.name}`,
      callback: {
        successUrl: 'https://homolog.atrupe.com.br',
      },
    };

    try {
      // Create subscription in Asaas
      const asaasSubscription = await this.createSubscription(data);

      // Create subscription in local database
      const subscription = await this.prisma.subscription.create({
        data: {
          customerId: finalCustomer.id,
          planId: plan.id,
          additionalAccesses: createSubscriptionDto.additionalAccesses,
          asaasSubscriptionId: asaasSubscription.id,
          modules: createSubscriptionDto.modules || plan.modules,
          nextDueDate: new Date(asaasSubscription.nextDueDate),
          cycle: createSubscriptionDto.cycle,
          billingType: createSubscriptionDto.billingType,
          value,
          status: asaasSubscription.status,
        },
      });

      return subscription;
    } catch (error) {
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

    // Combinar módulos existentes com os do novo plano (evitar duplicatas)
    const currentModules = currentSubscription.modules || [];
    const newPlanModules = newPlan.modules || [];
    const combinedModules = Array.from(
      new Set([...currentModules, ...newPlanModules]),
    );

    // Buscar informações dos módulos para calcular preço
    const modules = await this.prisma.module.findMany({
      where: { id: { in: combinedModules } },
    });

    // Calcular novo valor
    const modulesValue = modules.reduce((acc, module) => acc + module.price, 0);
    const newValue =
      newPlan.basePrice +
      modulesValue +
      newPlan.additionalAccessPrice * currentSubscription.additionalAccesses;

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
      data: { status: 'CANCELED' },
    });

    // Criar nova subscription
    const newSubscription = await this.prisma.subscription.create({
      data: {
        customerId: currentSubscription.customerId,
        companyId: currentSubscription.companyId,
        planId: newPlan.id,
        additionalAccesses: currentSubscription.additionalAccesses,
        asaasSubscriptionId: asaasSubscription.id,
        modules: combinedModules,
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
      include: { customer: true },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.companyId !== request.user.companyId) {
      throw new BadRequestException('Unauthorized access to this subscription');
    }

    // Verificar se o módulo existe
    const module = await this.prisma.module.findUnique({
      where: { id: moduleId },
    });

    if (!module) {
      throw new NotFoundException('Module not found');
    }

    // Verificar se o módulo já está incluído
    if (subscription.modules.includes(moduleId)) {
      throw new BadRequestException('Module already included in subscription');
    }

    // Adicionar módulo à lista
    const updatedModules = [...subscription.modules, moduleId];

    // Recalcular valor da subscription
    const modules = await this.prisma.module.findMany({
      where: { id: { in: updatedModules } },
    });

    const plan = await this.prisma.plan.findUnique({
      where: { id: subscription.planId },
    });

    const modulesValue = modules.reduce((acc, mod) => acc + mod.price, 0);
    const newValue =
      plan.basePrice +
      modulesValue +
      plan.additionalAccessPrice * subscription.additionalAccesses;

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
        modules: updatedModules,
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
      include: { customer: true, plan: true },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.companyId !== request.user.companyId) {
      throw new BadRequestException('Unauthorized access to this subscription');
    }

    // Verificar se o módulo está na lista
    if (!subscription.modules.includes(moduleId)) {
      throw new BadRequestException('Module not found in subscription');
    }

    // Verificar se o módulo é obrigatório do plano
    if (subscription.plan.modules.includes(moduleId)) {
      throw new BadRequestException(
        'Cannot remove module that is required by the plan',
      );
    }

    // Remover módulo da lista
    const updatedModules = subscription.modules.filter((id) => id !== moduleId);

    // Recalcular valor da subscription
    const modules = await this.prisma.module.findMany({
      where: { id: { in: updatedModules } },
    });

    const modulesValue = modules.reduce((acc, mod) => acc + mod.price, 0);
    const newValue =
      subscription.plan.basePrice +
      modulesValue +
      subscription.plan.additionalAccessPrice * subscription.additionalAccesses;

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
        modules: updatedModules,
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
    if (this.isMockMode) {
      console.log(
        '🎭 MOCK MODE: Simulando cancelamento de subscription no Asaas',
      );
      console.log('Subscription ID:', asaasSubscriptionId);
      return;
    }

    try {
      await axios.delete(
        `${this.asaasApiUrl}/subscriptions/${asaasSubscriptionId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            access_token: this.asaasToken,
            'User-Agent': 'YourAppName',
          },
        },
      );
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
    if (this.isMockMode) {
      console.log(
        '🎭 MOCK MODE: Simulando atualização de subscription no Asaas',
      );
      console.log('Subscription ID:', asaasSubscriptionId);
      console.log('Dados de atualização:', data);
      return {
        id: asaasSubscriptionId,
        ...data,
        dateUpdated: new Date().toISOString(),
      };
    }

    try {
      const response = await axios.post(
        `${this.asaasApiUrl}/subscriptions/${asaasSubscriptionId}`,
        data,
        {
          headers: {
            'Content-Type': 'application/json',
            access_token: this.asaasToken,
            'User-Agent': 'YourAppName',
          },
        },
      );
      return response.data;
    } catch (error) {
      console.error(
        'Error updating Asaas subscription:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to update subscription in Asaas');
    }
  }

  private async createSubscription(subscriptionData: any): Promise<any> {
    if (this.isMockMode) {
      return this.mockCreateSubscription(subscriptionData);
    }

    try {
      const response = await axios.post(
        `${this.asaasApiUrl}/subscriptions`,
        subscriptionData,
        {
          headers: {
            'Content-Type': 'application/json',
            access_token: this.asaasToken,
            'User-Agent': 'YourAppName',
          },
        },
      );
      return response.data;
    } catch (error) {
      console.error(
        'Erro ao criar assinatura no Asaas:',
        error.response?.data || error.message,
      );
      throw new Error('Falha ao criar assinatura no Asaas');
    }
  }

  private mockCreateSubscription(subscriptionData: any): any {
    console.log('🎭 MOCK MODE: Simulando criação de subscription no Asaas');
    console.log('Dados enviados:', subscriptionData);

    return {
      id: `sub_mock_${Date.now()}`,
      status: 'ACTIVE',
      nextDueDate: subscriptionData.nextDueDate,
      value: subscriptionData.value,
      customer: subscriptionData.customer,
      billingType: subscriptionData.billingType,
      cycle: subscriptionData.cycle,
      description: subscriptionData.description,
      dateCreated: new Date().toISOString(),
    };
  }
}
