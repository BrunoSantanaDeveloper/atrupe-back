import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { CreatePlanDTO, UpdatePlanDTO, SubscriptionDTO } from './dtos/plan';
import { CreateModuleDTO, UpdateModuleDTO } from './dtos/module';
import { PrismaService } from 'nestjs-prisma';
import { BASE_PLANS } from '../../seeds/plans-base';
import { asaasConfig } from 'src/config/configuration';

@Injectable()
export class PlanService {
  constructor(private prisma: PrismaService) {}
  private asaasToken = asaasConfig.token;

  // Plan CRUD Operations
  async createPlan(createPlanDTO: CreatePlanDTO) {
    try {
      return await this.prisma.plan.create({
        data: createPlanDTO,
      });
    } catch (error) {
      throw new BadRequestException('Error creating plan: ' + error.message);
    }
  }

  async findAllPlans() {
    try {
      const plans = await this.prisma.plan.findMany({});
      const modules = await this.prisma.module.findMany({});

      const data = plans.map((plan) => ({
        ...plan,
        modules: modules.filter((module) => plan.modules.includes(module.id)),
      }));

      return data;
    } catch (error) {
      throw new BadRequestException('Error fetching plans: ' + error.message);
    }
  }

  async findPlanById(id: string) {
    try {
      const plan = await this.prisma.plan.findUnique({
        where: { id },
      });

      if (!plan) {
        throw new NotFoundException('Plan not found');
      }

      const modules = await this.prisma.module.findMany({
        where: {
          id: { in: plan.modules },
        },
      });

      return { ...plan, modules };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error fetching plan: ' + error.message);
    }
  }

  async updatePlan(id: string, updatePlanDTO: UpdatePlanDTO) {
    try {
      await this.findPlanById(id);

      return await this.prisma.plan.update({
        where: { id },
        data: updatePlanDTO,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error updating plan: ' + error.message);
    }
  }

  async deletePlan(id: string) {
    try {
      return await this.prisma.plan.delete({
        where: { id },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error deleting plan: ' + error.message);
    }
  }

  // Module CRUD Operations
  async createModule(createModuleDTO: CreateModuleDTO) {
    try {
      return await this.prisma.module.create({
        data: createModuleDTO,
      });
    } catch (error) {
      throw new BadRequestException('Error creating module: ' + error.message);
    }
  }

  async findAllModules() {
    try {
      return await this.prisma.module.findMany();
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Error fetching modules: ' + error.message);
    }
  }

  async findModuleById(id: string) {
    try {
      const module = await this.prisma.module.findUnique({
        where: { id },
      });

      if (!module) {
        throw new NotFoundException('Module not found');
      }

      return module;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error fetching module: ' + error.message);
    }
  }

  async updateModule(id: string, updateModuleDTO: UpdateModuleDTO) {
    try {
      await this.findModuleById(id);

      return await this.prisma.module.update({
        where: { id },
        data: updateModuleDTO,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error updating module: ' + error.message);
    }
  }

  async deleteModule(id: string) {
    try {
      await this.findModuleById(id);

      return await this.prisma.module.delete({
        where: { id },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error deleting module: ' + error.message);
    }
  }

  async createDefaultPlans(companyId?: string) {
    const defaultPlans = BASE_PLANS.map((plan) => ({
      ...plan,
      companyId,
    }));

    // Se companyId for fornecido, verifica se já existem planos para a empresa
    if (companyId) {
      const plans = await this.prisma.plan.findMany({
        where: {
          companyId,
        },
      });

      if (plans.length > 0) {
        return {
          message: 'Plans already exist for this company',
          existing: plans.length,
        };
      }
    } else {
      // Se não for fornecido companyId, verifica se já existem planos globais
      const globalPlans = await this.prisma.plan.findMany({
        where: {
          companyId: null,
        },
      });

      if (globalPlans.length > 0) {
        return {
          message: 'Global plans already exist',
          existing: globalPlans.length,
        };
      }
    }

    const createdPlans = await Promise.all(
      defaultPlans.map((plan) => this.prisma.plan.create({ data: plan })),
    );

    return {
      message: 'Default plans created successfully',
      created: createdPlans.length,
      plans: createdPlans,
    };
  }

  async getCustomerId(customerData: SubscriptionDTO) {
    return 'customer_1234567890';
    try {
      const urlID = 'https://api-sandbox.asaas.com/v3/customers';
      const optionsID = {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          access_token: this.asaasToken,
        },
        body: JSON.stringify({
          name: customerData.name || customerData.companyName,
          cpfCnpj:
            customerData.cpfCnpj || customerData.cpf || customerData.cnpj,
          email: customerData.email,
          phone: customerData.phone,
          mobilePhone: customerData.mobilePhone,
          address: customerData.address,
          addressNumber: customerData.addressNumber,
          complement: customerData.complement,
          province: customerData.province,
          postalCode: customerData.postalCode,
        }),
      };
      const response = await fetch(urlID, optionsID);

      const clientData = await response.json();

      return clientData.id;
    } catch (error) {
      throw new BadRequestException(
        'Error creating customer: ' + error.message,
      );
    }
  }

  async createSubscription(data: {
    billingType: any;
    cycle: any;
    customer: string;
    value: number;
    nextDueDate: string;
  }) {
    return {
      url: 'www.cnn.com',
    };
    try {
      const urlSub = 'https://api-sandbox.asaas.com/v3/subscriptions';
      const optionsSub = {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          access_token: this.asaasToken,
        },
        body: JSON.stringify({
          billingType: data.billingType,
          cycle: data.cycle,
          customer: data.customer,
          value: data.value,
          nextDueDate: data.nextDueDate,
        }),
      };
      const responseSub = await fetch(urlSub, optionsSub);
      const subscriptionResponse = await responseSub.json();

      return subscriptionResponse;
    } catch (error) {
      throw new BadRequestException(
        'Error creating subscription: ' + error.message,
      );
    }
  }

  // async planSubscription(data: SubscriptionDTO) {
  //   try {
  //     let planExists;

  //     const isUUID =
  //       /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
  //         data.planId,
  //       );

  //     if (isUUID) {
  //       planExists = await this.prisma.plan.findUnique({
  //         where: {
  //           id: data.planId,
  //         },
  //       });
  //     } else {
  //       // Buscar por tipo de plano (START, LITE, etc.)
  //       planExists = await this.prisma.plan.findFirst({
  //         where: {
  //           type: data.planId.toUpperCase() as any,
  //           companyId: data.companyId,
  //         },
  //       });
  //     }

  //     if (!planExists) {
  //       throw new NotFoundException('Plan not found');
  //     }

  //     const companyExists = await this.prisma.company.findUnique({
  //       where: {
  //         id: data.companyId,
  //       },
  //     });

  //     if (!companyExists) {
  //       throw new NotFoundException('Company not found');
  //     }

  //     if (!planExists.isActive) {
  //       throw new BadRequestException('Plan is not active');
  //     }

  //     if (!data.isContractAccepted) {
  //       throw new BadRequestException('Contract not accepted');
  //     }

  //     const customerId = await this.getCustomerId(data);
  //     if (!customerId) {
  //       throw new BadRequestException('Customer not found');
  //     }

  //     const multiplier = (data.extraUsers || 0) * 15;
  //     const totalPayment = data.planPrice + multiplier;

  //     try {
  //       const subscription = await this.prisma.subscription.create({
  //         data: {
  //           plan: { connect: { id: planExists.id } },
  //           company: { connect: { id: data.companyId } },
  //           billingType: data.billingType as any,
  //           planPrice: totalPayment,
  //           cycle: data.cycle,
  //           isContractAccepted: data.isContractAccepted,
  //           name: data.name || data.companyName,
  //           cpfCnpj: data.cpfCnpj || data.cpf || data.cnpj,
  //           email: data.email,
  //           phone: data.phone,
  //           mobilePhone: data.mobilePhone,
  //           address: data.address,
  //           addressNumber: data.addressNumber,
  //           complement: data.complement,
  //           province: data.province,
  //           postalCode: data.postalCode,
  //           city: data.city,
  //           neighborhood: data.neighborhood,
  //         },
  //       });

  //       const subscriptionResponse = await this.createSubscription({
  //         billingType: subscription.billingType,
  //         cycle: subscription.cycle,
  //         customer: customerId,
  //         value: subscription.planPrice,
  //         nextDueDate: new Date(
  //           subscription.createdAt.getTime() + 40 * 24 * 60 * 60 * 1000,
  //         ).toISOString(),
  //       });

  //       return { totalPrice: totalPayment, subscriptionResponse };
  //     } catch (error) {
  //       console.error(error);
  //       throw new BadRequestException(
  //         'Error creating plan subscription: ' + error.message,
  //       );
  //     }
  //   } catch (error) {
  //     throw new BadRequestException(
  //       'Error creating plan subscription: ' + error.message,
  //     );
  //   }
  // }
}
