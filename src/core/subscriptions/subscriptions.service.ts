import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import axios from 'axios';
import { CustomersService } from '../customers/customers.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private customerSerivce: CustomersService,
  ) {}
  private asaasToken = `$${process.env.ASAAS_TOKEN}`;
  private asaasApiUrl = process.env.ASAAS_API_URL_SANDBOX;

  async create(createSubscriptionDto: CreateSubscriptionDto, request) {
    createSubscriptionDto.customer.userId = request.user.userId;
    createSubscriptionDto.customer.companyId = request.user.companyId;
    const { customer } = createSubscriptionDto;
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
    return;
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

  private async createSubscription(subscriptionData: any): Promise<any> {
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
}
