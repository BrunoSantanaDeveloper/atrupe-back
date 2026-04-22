import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { v4 as uuidv4 } from 'uuid';
import { SubscriptionStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const TRIAL_DAYS_DEFAULT = 7;
const NEXT_DUE_DATE_DAYS_DEFAULT = 30;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private customerService: CustomersService,
    private asaasGateway: AsaasGatewayService,
  ) {}

  async findActiveByCompanyId(companyId: string) {
    const includeRelations = {
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
      payments: {
        orderBy: { createdAt: 'desc' as const },
        take: 1,
      },
    };

    // 1. Priorizar subscription ACTIVE não-TRIAL (plano pago ativo)
    const activePaid = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: 'ACTIVE',
        plan: { planType: { not: 'TRIAL' } },
      },
      orderBy: { createdAt: 'desc' },
      include: includeRelations,
    });

    if (activePaid) return activePaid;

    // 2. Fallback: qualquer subscription ACTIVE (incluindo TRIAL)
    const activeAny = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
      include: includeRelations,
    });

    if (activeAny) return activeAny;

    // 3. Último fallback: subscription mais recente (qualquer status)
    return this.prisma.subscription.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: includeRelations,
    });
  }

  async listPaymentsByCompanyId(companyId: string, page = 1, limit = 10) {
    const where = { subscription: { companyId: companyId } };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          subscription: {
            select: {
              additionalUsers: true,
              plan: { select: { name: true, basePrice: true } },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      lastPage: Math.ceil(total / limit) || 1,
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

      // Verificar se o customer existente precisa ser criado no Asaas (ex: trial_, temp_, null)
      if (!existingCustomer.asaasCustomerId?.startsWith('cus_')) {
        this.logger.log(
          'Cliente sem ID válido no Asaas detectado, provisionando...',
        );

        // Criar o customer no Asaas com os dados recebidos
        const customerDataForAsaas: Record<string, any> = {
          name: customer.name,
          cpfCnpj: customer.document,
          email: customer.email,
          mobilePhone: customer.mobilePhone || customer.phone,
          postalCode: customer.postalCode,
          addressNumber: customer.addressNumber,
          complement: customer.complement,
          externalReference: existingCustomer.id,
        };

        // Only send phone (landline) if provided and different from mobile
        if (customer.phone && customer.phone !== customer.mobilePhone) {
          customerDataForAsaas.phone = customer.phone;
        }

        try {
          const asaasCustomer =
            await this.asaasGateway.createAsaasCustomer(customerDataForAsaas);

          // Atualizar o customer no banco com o ID real do Asaas
          finalCustomer = await this.prisma.customer.update({
            where: { id: existingCustomer.id },
            data: {
              asaasCustomerId: asaasCustomer.id,
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
            asaasCustomer.id,
          );
        } catch (error) {
          this.logger.error('Erro ao criar cliente no Asaas:', {
            message: error.message,
          });

          throw new BadRequestException(
            error.message || 'Falha ao criar cliente no Asaas',
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

        if (existingSubscription) {
          if (existingSubscription.status === 'ACTIVE') {
            throw new BadRequestException(
              'Uma assinatura ativa já existe para esta empresa.',
            );
          }

          // Subscription INACTIVE: verificar se todos os pagamentos estão vencidos (OVERDUE)
          // Se sim, cancelar automaticamente para liberar novo checkout
          const payments = await tx.payment.findMany({
            where: { subscriptionId: existingSubscription.id },
          });

          // Considerar OVERDUE tanto pelo status local quanto pela data de vencimento.
          // Sem webhook/cron, o status local pode ficar PENDING eternamente
          // mesmo após a cobrança vencer no Asaas.
          const now = new Date();
          const allOverdue =
            payments.length > 0 &&
            payments.every(
              (p) =>
                p.status === 'OVERDUE' ||
                (p.status === 'PENDING' && p.dueDate && p.dueDate < now),
            );

          const isTempOrAborted =
            existingSubscription.asaasSubscriptionId.startsWith('temp_') ||
            payments.length === 0;

          if (allOverdue || isTempOrAborted) {
            this.logger.log(
              `Auto-cancelando subscription ${existingSubscription.id} — pagamentos OVERDUE ou checkout abortado`,
            );

            // Cancelar no Asaas (se não for temporária)
            if (!existingSubscription.asaasSubscriptionId.startsWith('temp_')) {
              try {
                await this.asaasGateway.cancelAsaasSubscription(
                  existingSubscription.asaasSubscriptionId,
                );
              } catch (err) {
                this.logger.warn(
                  `Falha ao cancelar subscription no Asaas: ${err.message}`,
                );
              }
            }

            // Cancelar no banco
            await tx.subscription.update({
              where: { id: existingSubscription.id },
              data: { status: 'CANCELED' },
            });

            this.logger.log(
              `Subscription ${existingSubscription.id} cancelada automaticamente`,
            );
          } else {
            throw new BadRequestException(
              'Um checkout já está em andamento para esta empresa. Aguarde a confirmação do pagamento.',
            );
          }
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

        // Registrar o aceite do contrato
        const latestContract = await tx.contract.findFirst({
          orderBy: { version: 'desc' },
        });

        if (latestContract) {
          const existingAcceptance = await tx.userContract.findUnique({
            where: {
              userId_contractId: {
                userId: request.user.userId,
                contractId: latestContract.id,
              },
            },
          });

          if (!existingAcceptance) {
            await tx.userContract.create({
              data: {
                userId: request.user.userId,
                contractId: latestContract.id,
                ipAddress: request.ip || '0.0.0.0',
                userAgent: request.headers['user-agent'] || '',
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

      let asaasSubscription;
      try {
        asaasSubscription = await this.asaasGateway.createSubscription(data);
      } catch (error) {
        const errorMsg = error.message.toLowerCase();
        if (
          errorMsg.includes('cliente inválido') ||
          errorMsg.includes('cliente não') ||
          errorMsg.includes('customer')
        ) {
          this.logger.warn(
            `Asaas ID do cliente parece obsoleto/inválido. Limpando do banco local para re-provisionamento. ID Local: ${finalCustomer.id}`,
          );
          await this.prisma.customer.update({
            where: { id: finalCustomer.id },
            data: { asaasCustomerId: `invalid_${uuidv4()}` },
          });
        }
        throw error;
      }

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

      const asaasPayments =
        await this.asaasGateway.getAsaasSubscriptionPayments(
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
          status: this.asaasGateway.mapAsaasPaymentStatus(
            firstAsaasPayment.status,
          ),
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
      await this.asaasGateway.cancelAsaasSubscription(
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
        successUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
      },
    };

    const asaasSubscription =
      await this.asaasGateway.createSubscription(asaasData);

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
        status: asaasSubscription.status as SubscriptionStatus,
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

    // Registrar o aceite do contrato
    const latestContract = await this.prisma.contract.findFirst({
      orderBy: { version: 'desc' },
    });

    if (latestContract) {
      const existingAcceptance = await this.prisma.userContract.findUnique({
        where: {
          userId_contractId: {
            userId: request.user.userId,
            contractId: latestContract.id,
          },
        },
      });

      if (!existingAcceptance) {
        await this.prisma.userContract.create({
          data: {
            userId: request.user.userId,
            contractId: latestContract.id,
            ipAddress: request.ip || '0.0.0.0',
            userAgent: request.headers['user-agent'] || '',
          },
        });
      }
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

    // Calcular valor sem features extras
    const plan = await this.prisma.plan.findUnique({
      where: { id: subscription.planId },
    });

    // Atualizar subscription no Asaas primeiro (fora da transaction — chamada externa)
    const modulesValue =
      subscription.subscriptionFeatures.reduce(
        (sum, sf) => sum + (sf.price || 0),
        0,
      ) + (feature.price || 0);
    const newValue =
      (plan.basePrice +
        modulesValue +
        (plan.additionalUserPrice || 0) * (subscription.additionalUsers || 0)) /
      100;

    try {
      await this.asaasGateway.updateAsaasSubscription(
        subscription.asaasSubscriptionId,
        {
          value: newValue,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to update subscription in Asaas: ${error.message}`,
      );
    }

    // Mutações atômicas — criar feature, atualizar subscription, registrar histórico
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionFeature.create({
        data: {
          subscriptionId,
          featureId: feature.id,
          price: feature.price,
        },
      });

      const result = await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          value: newValue,
        },
        include: {
          plan: true,
          customer: true,
        },
      });

      await tx.subscriptionHistory.create({
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

      return result;
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
      await this.asaasGateway.updateAsaasSubscription(
        subscription.asaasSubscriptionId,
        {
          value: newValue,
        },
      );
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

  async cancelSubscription(
    subscriptionId: string,
    cancelDto: CancelSubscriptionDto,
    companyId: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new NotFoundException('Assinatura não encontrada.');
    }

    if (subscription.companyId !== companyId) {
      throw new BadRequestException('Acesso não autorizado a esta assinatura.');
    }

    if (subscription.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Apenas assinaturas ativas podem ser canceladas.',
      );
    }

    if (subscription.plan.planType === 'TRIAL') {
      throw new BadRequestException(
        'Assinaturas trial não podem ser canceladas por este fluxo.',
      );
    }

    // Cancelar no Asaas
    if (!subscription.asaasSubscriptionId.startsWith('temp_')) {
      try {
        await this.asaasGateway.cancelAsaasSubscription(
          subscription.asaasSubscriptionId,
        );
      } catch (error) {
        this.logger.warn(
          `Falha ao cancelar subscription no Asaas: ${error.message}`,
        );
      }
    }

    // Atualizar status no banco e registrar histórico atomicamente
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { id: subscriptionId },
        data: { status: 'CANCELED' },
        include: { plan: true },
      });

      await tx.subscriptionHistory.create({
        data: {
          subscriptionId,
          action: 'CANCELED',
          description: `Assinatura cancelada pelo usuário. Motivo: ${cancelDto.reason}`,
          changes: {
            before: { status: 'ACTIVE' },
            after: { status: 'CANCELED' },
          },
          metadata: {
            reason: cancelDto.reason,
            feedback: cancelDto.feedback || null,
            canceledAt: new Date().toISOString(),
          },
          createdByName: 'Usuário',
        },
      });

      return result;
    });

    this.logger.log(
      `Subscription ${subscriptionId} cancelada. Motivo: ${cancelDto.reason}`,
    );

    return {
      success: true,
      message: 'Assinatura cancelada com sucesso.',
      subscription: updated,
    };
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

      const asaasPayments =
        await this.asaasGateway.getAsaasSubscriptionPayments(
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

      // Calcular dias de atraso
      let daysOverdue = 0;
      const overdueTarget = overduePayment || pendingOverduePayment;
      if (overdueTarget?.dueDate) {
        const dueDate = new Date(overdueTarget.dueDate);
        const now = new Date();
        daysOverdue = Math.floor(
          (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysOverdue < 0) daysOverdue = 0;
      }

      // Determinar mensagem apropriada baseada nos status
      let message: string;
      if (hasOverduePayment) {
        message =
          daysOverdue > 0
            ? `Cliente inadimplente! Pagamento vencido há ${daysOverdue} dia${daysOverdue !== 1 ? 's' : ''}.`
            : 'Cliente inadimplente! Há pagamento vencido ou em atraso.';
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
        daysOverdue: hasOverduePayment ? daysOverdue : undefined,
        overdueDueDate: overdueTarget?.dueDate || undefined,
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
    // Excluir CANCELED para não pegar subscriptions órfãs dos testes/auto-cancel
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: {
          in: ['ACTIVE', 'INACTIVE'],
        },
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
        subscriptionFeatures: {
          include: {
            feature: true,
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

    // Verificar se a subscription foi manualmente inativada por um admin.
    // Nesse caso, NÃO deve ser reativada automaticamente via sync com Asaas.
    // A reativação só deve ocorrer via ação explícita do admin no painel.
    const lastHistory = await this.prisma.subscriptionHistory.findFirst({
      where: { subscriptionId: subscription.id },
      orderBy: { createdAt: 'desc' },
    });

    const wasManuallyDeactivated =
      lastHistory?.action === 'STATUS_CHANGE' &&
      lastHistory?.metadata !== null &&
      typeof lastHistory.metadata === 'object' &&
      !Array.isArray(lastHistory.metadata) &&
      (lastHistory.metadata as Record<string, unknown>)['newStatus'] ===
        'INACTIVE';

    if (wasManuallyDeactivated) {
      this.logger.warn(
        `Subscription ${subscription.id} foi manualmente inativada por admin. Auto-ativação bloqueada.`,
      );
      return { status: 'manually_deactivated', subscription };
    }

    try {
      // Buscar os pagamentos da subscription no Asaas
      const asaasPayments =
        await this.asaasGateway.getAsaasSubscriptionPayments(
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
            subscriptionFeatures: {
              include: {
                feature: true,
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
}
