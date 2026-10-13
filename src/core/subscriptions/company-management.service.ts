import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import { UpdateActiveClientDto } from './dto/update-active-client.dto';
import { v4 as uuidv4 } from 'uuid';
import * as argon2 from 'argon2';

const TRIAL_DAYS_DEFAULT = 7;

/**
 * Parcela que o Asaas ainda vai receber: a do cartão aprovada e ainda não
 * liquidada (CONFIRMED) conta, porque o cliente segue pagando a fatura.
 */
const INSTALLMENT_TO_RECEIVE = [
  'PENDING',
  'OVERDUE',
  'CONFIRMED',
  'AWAITING_RISK_ANALYSIS',
];

@Injectable()
export class CompanyManagementService {
  private readonly logger = new Logger(CompanyManagementService.name);

  constructor(
    private prisma: PrismaService,
    private asaasGateway: AsaasGatewayService,
  ) {}

  /**
   * A assinatura da empresa que o Asaas ainda cobra — ativa no sistema ou
   * não: a que ficou inativa aqui (pagamento que o sistema não viu, por
   * exemplo) também segue gerando cobranças lá.
   */
  private async liveGatewaySubscription(companyId: string) {
    const candidates = await this.prisma.subscription.findMany({
      where: {
        companyId,
        status: { in: ['ACTIVE', 'INACTIVE'] },
        asaasSubscriptionId: { startsWith: 'sub_' },
        asaasInstallmentId: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { name: true } } },
    });
    for (const subscription of candidates) {
      const remote = await this.asaasGateway.getAsaasSubscription(
        subscription.asaasSubscriptionId,
      );
      if (remote && !remote.deleted && remote.status === 'ACTIVE') {
        return { ...subscription, remoteValue: Number(remote.value) };
      }
    }
    return null;
  }

  /**
   * O anual parcelado da empresa com parcela ainda a receber no Asaas. O
   * parcelamento não é assinatura no Asaas (cada ano é uma cobrança
   * parcelada no cartão): encerrar a assinatura aqui não para as parcelas.
   * Vale também a assinatura que ficou inativa aqui, como na recorrente.
   */
  private async liveInstallment(companyId: string) {
    const candidates = await this.prisma.subscription.findMany({
      where: {
        companyId,
        status: { in: ['ACTIVE', 'INACTIVE'] },
        asaasInstallmentId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { name: true } } },
    });
    for (const subscription of candidates) {
      const payments = await this.asaasGateway.getInstallmentPayments(
        subscription.asaasInstallmentId,
      );
      const toReceive = payments.filter(
        (payment) =>
          !payment.deleted && INSTALLMENT_TO_RECEIVE.includes(payment.status),
      );
      if (toReceive.length) {
        return { ...subscription, toReceive: toReceive.length };
      }
    }
    return null;
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

    // Plano escolhido pelo admin. Sem planId, mantém o comportamento
    // histórico e usa o START.
    const plan = assignDto.planId
      ? await this.prisma.plan.findUnique({ where: { id: assignDto.planId } })
      : await this.prisma.plan.findFirst({ where: { planType: 'START' } });

    if (!plan) {
      throw new NotFoundException(
        assignDto.planId
          ? 'Plano não encontrado.'
          : 'Plano START não encontrado no sistema.',
      );
    }

    if (!plan.isActive) {
      throw new BadRequestException(
        'Este plano não está disponível para contratação.',
      );
    }

    if (!plan.basePrice || plan.basePrice <= 0) {
      throw new BadRequestException('Este plano não possui preço definido.');
    }

    // Plano manual não é cobrado. Com uma cobrança viva no Asaas, ele deixaria
    // o Asaas cobrando por fora de uma assinatura que o sistema não acompanha.
    const charging = await this.liveGatewaySubscription(assignDto.companyId);
    if (charging) {
      throw new ConflictException({
        code: 'GATEWAY_BILLING_ACTIVE',
        message: `A empresa tem uma cobrança ativa no Asaas (${charging.plan.name}, R$ ${charging.remoteValue.toFixed(2).replace('.', ',')}). Reative essa assinatura em vez de atribuir um plano manual, ou cancele a cobrança antes.`,
      });
    }

    // O mesmo vale para o anual parcelado (CR-6): sem esta trava, a
    // assinatura era encerrada e as parcelas seguiam cobradas no cartão
    const installment = await this.liveInstallment(assignDto.companyId);
    if (installment) {
      throw new ConflictException({
        code: 'GATEWAY_BILLING_ACTIVE',
        message: `A empresa está no anual parcelado (${installment.plan.name}), com ${installment.toReceive} parcela(s) a receber no Asaas. Cancele o parcelamento antes de atribuir um plano manual.`,
      });
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
      `Subscription ${plan.name} atribuída manualmente: ${subscription.id} para empresa ${company.name}`,
    );

    return {
      message: `Plano ${plan.name} atribuído com sucesso à empresa.`,
      subscription: await this.prisma.subscription.findUnique({
        where: { id: subscription.id },
        include: {
          plan: true,
          customer: true,
        },
      }),
    };
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
      throw new UnauthorizedException('Senha do administrador incorreta.');
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

    // Reativar à mão uma assinatura cuja cobrança não existe mais no Asaas
    // libera o acesso sem nada cobrando. Cortesia é plano manual.
    if (updateDto.status === 'ACTIVE') {
      const target = await this.prisma.subscription.findFirst({
        where: { companyId: company.id },
        orderBy: { createdAt: 'desc' },
        select: { asaasSubscriptionId: true, asaasInstallmentId: true },
      });
      if (
        target?.asaasSubscriptionId.startsWith('sub_') &&
        !target.asaasInstallmentId
      ) {
        const remote = await this.asaasGateway.getAsaasSubscription(
          target.asaasSubscriptionId,
        );
        if (!remote || remote.deleted || remote.status !== 'ACTIVE') {
          throw new BadRequestException({
            code: 'GATEWAY_BILLING_ENDED',
            message:
              'A cobrança desta assinatura não está mais ativa no Asaas: reativá-la liberaria o acesso sem nada cobrando. Para uma cortesia, atribua um plano manual.',
          });
        }
      }
    }

    // Todas as mutações dentro de uma transaction para atomicidade
    await this.prisma.$transaction(async (tx) => {
      // Atualizar empresa se houver alterações
      if (Object.keys(companyUpdateData).length > 0) {
        await tx.company.update({
          where: { id: companyId },
          data: companyUpdateData,
        });
      }

      // Atualizar endereço
      if (updateDto.stateId || updateDto.cityId) {
        const address = company.address[0];
        if (address) {
          await tx.address.update({
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
          await tx.user.update({
            where: { id: employee.user.id },
            data: userUpdateData,
          });
        }

        // Atualizar employee (CPF)
        if (updateDto.userDocument) {
          await tx.employee.update({
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
          await tx.customer.update({
            where: { id: company.customer[0].id },
            data: customerUpdateData,
          });
        }
      }

      // Atualizar status da subscription (se fornecido)
      if (updateDto.status) {
        const subscription = await tx.subscription.findFirst({
          where: { companyId: company.id },
          orderBy: { createdAt: 'desc' },
        });

        if (subscription) {
          // Se está ativando uma subscription, desativar todas as outras ativas da mesma empresa
          if (updateDto.status === 'ACTIVE') {
            const otherActiveSubscriptions = await tx.subscription.findMany({
              where: {
                companyId: company.id,
                status: 'ACTIVE',
                id: { not: subscription.id },
              },
            });

            for (const otherSubscription of otherActiveSubscriptions) {
              await tx.subscription.update({
                where: { id: otherSubscription.id },
                data: { status: 'INACTIVE' },
              });

              // Criar histórico para cada subscription desativada
              await tx.subscriptionHistory.create({
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

          await tx.subscription.update({
            where: { id: subscription.id },
            data: { status: updateDto.status },
          });
          changes.after.status = updateDto.status;

          // Criar histórico da subscription
          await tx.subscriptionHistory.create({
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
            await tx.company.update({
              where: { id: companyId },
              data: {
                blockLevel: 'PARTIAL',
                blockedAt: new Date(),
                blockReason: `Bloqueio manual por ${adminUser.name}`,
              },
            });
          } else if (updateDto.status === 'INACTIVE') {
            await tx.company.update({
              where: { id: companyId },
              data: {
                blockLevel: 'FULL',
                isActive: false,
                blockedAt: new Date(),
                blockReason: `Inativação manual por ${adminUser.name}`,
              },
            });
          } else if (updateDto.status === 'ACTIVE') {
            await tx.company.update({
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
      await tx.companyHistory.create({
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
    });

    return {
      message: 'Cliente atualizado com sucesso',
    };
  }

  /**
   * Retorna os dados de endereço do customer vinculado à empresa.
   */
  async getCustomerAddress(companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { companyId },
      select: {
        id: true,
        asaasCustomerId: true,
        postalCode: true,
        address: true,
        addressNumber: true,
        complement: true,
        province: true,
        city: true,
        state: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer não encontrado para esta empresa');
    }

    return customer;
  }

  /**
   * Atualiza o endereço do customer localmente e no Asaas.
   * Requer senha do administrador.
   */
  async syncCustomerAddressToAsaas(
    companyId: string,
    dto: {
      postalCode?: string;
      address?: string;
      addressNumber?: string;
      complement?: string;
      province?: string;
      city?: string;
      state?: string;
      password: string;
    },
    adminUserId: string,
  ) {
    const adminUser = await this.prisma.user.findUnique({
      where: { id: adminUserId },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    const isPasswordValid = await argon2.verify(
      adminUser.password,
      dto.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Senha do administrador incorreta.');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { companyId },
    });

    if (!customer) {
      throw new NotFoundException('Customer não encontrado para esta empresa');
    }

    // Atualizar localmente
    const updateData: any = {};
    if (dto.postalCode !== undefined) updateData.postalCode = dto.postalCode;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.addressNumber !== undefined)
      updateData.addressNumber = dto.addressNumber;
    if (dto.complement !== undefined) updateData.complement = dto.complement;
    if (dto.province !== undefined) updateData.province = dto.province;
    if (dto.city !== undefined) updateData.city = dto.city;
    if (dto.state !== undefined) updateData.state = dto.state;

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: updateData,
    });

    // Atualizar no Asaas (apenas se tiver ID real, não temp_ ou trial_)
    const hasAsaasLink =
      customer.asaasCustomerId &&
      !customer.asaasCustomerId.startsWith('temp_') &&
      !customer.asaasCustomerId.startsWith('trial_') &&
      !customer.asaasCustomerId.startsWith('manual_');

    if (hasAsaasLink) {
      await this.asaasGateway.updateAsaasCustomer(
        customer.asaasCustomerId,
        updateData,
      );
    }

    this.logger.log(
      `Endereço do customer ${customer.id} atualizado por ${adminUser.name}. Asaas: ${hasAsaasLink ? 'sincronizado' : 'ignorado (sem vínculo)'}`,
    );

    return {
      message: 'Endereço atualizado com sucesso',
      asaasSynced: hasAsaasLink,
    };
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
      select: {
        id: true,
        customerId: true,
        asaasSubscriptionId: true,
        asaasInstallmentId: true,
      },
    });
    const subscriptionIds = subscriptions.map((s) => s.id);
    const customerIds = [...new Set(subscriptions.map((s) => s.customerId))];

    this.logger.log(
      `Iniciando exclusão da empresa ${companyName} (${companyId}) pelo admin ${adminUser.name}`,
    );

    // Cancelar subscriptions no Asaas ANTES de deletar do banco
    for (const sub of subscriptions) {
      // Anual parcelado: não há assinatura no Asaas; o que ainda não foi pago
      // do parcelamento deixa de existir.
      if (sub.asaasInstallmentId) {
        try {
          await this.asaasGateway.deleteInstallment(sub.asaasInstallmentId);
        } catch (error) {
          this.logger.warn(
            `Falha ao remover o parcelamento ${sub.asaasInstallmentId}: ${error.message}`,
          );
        }
        continue;
      }
      if (sub.asaasSubscriptionId) {
        try {
          await this.asaasGateway.cancelAsaasSubscription(
            sub.asaasSubscriptionId,
          );
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
    // IMPORTANTE: A ordem das operações respeita constraints de FK.
    // NÃO reordenar sem verificar dependências no schema.prisma.
    // TODO (#28): Avaliar remoção de Payment.externalReference (campo redundante — armazena o próprio ID)
    try {
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

          // 13. Ativos (os custos e as configurações do bem saem junto) e as
          // marcas e o histórico da base de custos
          await tx.asset.deleteMany({ where: { companyId } });
          await tx.assetGroup.deleteMany({ where: { companyId } });
          await tx.assetType.deleteMany({ where: { companyId } });
          await tx.costBaseSettings.deleteMany({ where: { companyId } });
          await tx.costBaseExpense.deleteMany({ where: { companyId } });
          await tx.employeeWorkload.deleteMany({ where: { companyId } });
          await tx.costAuditLog.deleteMany({ where: { companyId } });

          // 13.1 Composição, processos e materiais (os produtos já saíram;
          // linhas, campos e fórmulas saem junto)
          await tx.productAssembly.deleteMany({ where: { companyId } });
          await tx.process.deleteMany({ where: { companyId } });
          await tx.materialImportLink.deleteMany({ where: { companyId } });
          await tx.material.deleteMany({ where: { companyId } });

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
    } catch (error) {
      this.logger.error(
        `Falha ao excluir empresa ${companyName} (${companyId}): ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
