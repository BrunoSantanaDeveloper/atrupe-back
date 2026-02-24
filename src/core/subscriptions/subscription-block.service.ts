import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BlockLevel, AsaasPaymentStatus } from '@prisma/client';
import { AsaasGatewayService } from './asaas-gateway.service';

export interface BlockCheckResult {
  companyId: string;
  companyName: string;
  daysOverdue: number;
  previousBlockLevel: BlockLevel;
  newBlockLevel: BlockLevel;
  action: 'blocked' | 'upgraded' | 'unchanged' | 'skipped' | 'unblocked';
}

@Injectable()
export class SubscriptionBlockService {
  private readonly logger = new Logger(SubscriptionBlockService.name);

  // Regras de bloqueio (dias de atraso)
  private readonly DAYS_FOR_PARTIAL_BLOCK = 3;
  private readonly DAYS_FOR_FULL_BLOCK = 7;

  // Flag para ativar/desativar o cron de bloqueio
  private readonly isCronActive = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasGateway: AsaasGatewayService,
  ) {}

  /**
   * Cron job executado diariamente às 3h para verificar atrasos
   */
  @Cron('0 3 * * *', {
    name: 'subscription-block-check',
    timeZone: 'America/Sao_Paulo',
  })
  async handleCron(): Promise<void> {
    if (!this.isCronActive) {
      this.logger.log(
        'Cron de bloqueio desativado (isCronActive = false). Pulando execução.',
      );
      return;
    }

    this.logger.log('Iniciando verificação de bloqueios de assinatura...');

    try {
      // 1. Verificar e aplicar novos bloqueios
      const blockResults = await this.checkAndApplyBlocks();

      const blocked = blockResults.filter(
        (r) => r.action !== 'unchanged' && r.action !== 'skipped',
      );
      if (blocked.length > 0) {
        this.logger.log(`Bloqueios aplicados: ${blocked.length} empresas`);
        blocked.forEach((r) => {
          this.logger.log(
            `  - ${r.companyName}: ${r.previousBlockLevel} -> ${r.newBlockLevel} (${r.daysOverdue} dias de atraso)`,
          );
        });
      } else {
        this.logger.log('Nenhum novo bloqueio aplicado.');
      }

      // 2. Verificar empresas bloqueadas e desbloquear se pagaram
      const unblockResults = await this.checkAndUnblockCompanies();

      const unblocked = unblockResults.filter((r) => r.action === 'unblocked');
      if (unblocked.length > 0) {
        this.logger.log(`Empresas desbloqueadas: ${unblocked.length}`);
        unblocked.forEach((r) => {
          this.logger.log(
            `  - ${r.companyName}: ${r.previousBlockLevel} -> NONE (pagamento confirmado no Asaas)`,
          );
        });
      } else {
        this.logger.log('Nenhuma empresa desbloqueada.');
      }
    } catch (error) {
      this.logger.error('Erro ao verificar bloqueios:', error);
    }
  }

  /**
   * Verifica todas as empresas com assinaturas ativas e aplica bloqueios conforme atraso.
   * Consulta o Asaas diretamente para confirmar inadimplência real,
   * evitando bloqueios incorretos quando webhooks falham.
   */
  async checkAndApplyBlocks(): Promise<BlockCheckResult[]> {
    const results: BlockCheckResult[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Buscar empresas com assinaturas ativas
    const companiesWithSubscriptions = await this.prisma.company.findMany({
      where: {
        isActive: true,
        Subscription: {
          some: {
            status: 'ACTIVE',
          },
        },
      },
      select: {
        id: true,
        name: true,
        blockLevel: true,
        Subscription: {
          where: { status: 'ACTIVE' },
          select: {
            asaasSubscriptionId: true,
            nextDueDate: true,
          },
        },
      },
    });

    for (const company of companiesWithSubscriptions) {
      const subscription = company.Subscription[0];
      if (!subscription) continue;

      // Pular subscriptions manuais (sem vínculo Asaas)
      if (
        !subscription.asaasSubscriptionId ||
        subscription.asaasSubscriptionId.startsWith('manual_')
      ) {
        results.push({
          companyId: company.id,
          companyName: company.name,
          daysOverdue: 0,
          previousBlockLevel: company.blockLevel,
          newBlockLevel: company.blockLevel,
          action: 'skipped',
        });
        continue;
      }

      // Consultar pagamentos diretamente no Asaas
      let daysOverdue = 0;
      try {
        const asaasPayments =
          await this.asaasGateway.getAsaasSubscriptionPayments(
            subscription.asaasSubscriptionId,
          );

        if (!asaasPayments || asaasPayments.length === 0) {
          this.logger.warn(
            `Nenhum pagamento encontrado no Asaas para ${company.name} (${subscription.asaasSubscriptionId})`,
          );
          results.push({
            companyId: company.id,
            companyName: company.name,
            daysOverdue: 0,
            previousBlockLevel: company.blockLevel,
            newBlockLevel: company.blockLevel,
            action: 'skipped',
          });
          continue;
        }

        // Encontrar pagamento OVERDUE ou PENDING vencido no Asaas
        const todayStr = today.toISOString().split('T')[0];
        const overduePayment = asaasPayments.find(
          (p) =>
            p.status === 'OVERDUE' ||
            (p.status === 'PENDING' && p.dueDate < todayStr),
        );

        if (overduePayment) {
          const dueDate = new Date(overduePayment.dueDate);
          dueDate.setHours(0, 0, 0, 0);
          daysOverdue = Math.floor(
            (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
          );
        }

        // Se não há inadimplência no Asaas, empresa NÃO deve ser bloqueada
        if (daysOverdue <= 0) {
          results.push({
            companyId: company.id,
            companyName: company.name,
            daysOverdue: 0,
            previousBlockLevel: company.blockLevel,
            newBlockLevel: company.blockLevel,
            action: 'unchanged',
          });
          continue;
        }
      } catch (error) {
        // Se falhar ao consultar Asaas, NÃO bloquear — logar e pular
        this.logger.error(
          `Erro ao consultar Asaas para ${company.name}: ${error.message}. Pulando empresa.`,
        );
        results.push({
          companyId: company.id,
          companyName: company.name,
          daysOverdue: 0,
          previousBlockLevel: company.blockLevel,
          newBlockLevel: company.blockLevel,
          action: 'skipped',
        });
        continue;
      }

      // Determinar nível de bloqueio apropriado
      let newBlockLevel: BlockLevel = 'NONE';
      if (daysOverdue >= this.DAYS_FOR_FULL_BLOCK) {
        newBlockLevel = 'FULL';
      } else if (daysOverdue >= this.DAYS_FOR_PARTIAL_BLOCK) {
        newBlockLevel = 'PARTIAL';
      }

      // Aplicar bloqueio se necessário (só aumenta, nunca diminui automaticamente)
      const currentLevel = company.blockLevel;
      const blockOrder = { NONE: 0, PARTIAL: 1, FULL: 2 };

      if (blockOrder[newBlockLevel] > blockOrder[currentLevel]) {
        await this.prisma.company.update({
          where: { id: company.id },
          data: {
            blockLevel: newBlockLevel,
            blockedAt: new Date(),
            blockReason: `Assinatura com ${daysOverdue} dias de atraso (verificado no Asaas)`,
            // Quando bloqueio total, marcar empresa como inativa
            ...(newBlockLevel === 'FULL' && { isActive: false }),
          },
        });

        results.push({
          companyId: company.id,
          companyName: company.name,
          daysOverdue,
          previousBlockLevel: currentLevel,
          newBlockLevel,
          action: currentLevel === 'NONE' ? 'blocked' : 'upgraded',
        });
      } else {
        results.push({
          companyId: company.id,
          companyName: company.name,
          daysOverdue,
          previousBlockLevel: currentLevel,
          newBlockLevel: currentLevel,
          action: 'unchanged',
        });
      }
    }

    return results;
  }

  /**
   * Verifica empresas bloqueadas e desbloqueia automaticamente se pagaram no Asaas.
   * Também sincroniza payments faltantes do Asaas para o DB local.
   */
  async checkAndUnblockCompanies(): Promise<BlockCheckResult[]> {
    const results: BlockCheckResult[] = [];

    // Buscar empresas bloqueadas (PARTIAL ou FULL)
    const blockedCompanies = await this.prisma.company.findMany({
      where: {
        blockLevel: { in: ['PARTIAL', 'FULL'] },
      },
      select: {
        id: true,
        name: true,
        blockLevel: true,
        Subscription: {
          where: {
            plan: { planType: { not: 'TRIAL' } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            asaasSubscriptionId: true,
            nextDueDate: true,
            status: true,
          },
        },
      },
    });

    for (const company of blockedCompanies) {
      const subscription = company.Subscription[0];
      if (!subscription) {
        results.push({
          companyId: company.id,
          companyName: company.name,
          daysOverdue: 0,
          previousBlockLevel: company.blockLevel,
          newBlockLevel: company.blockLevel,
          action: 'skipped',
        });
        continue;
      }

      // Pular subscriptions manuais
      if (
        !subscription.asaasSubscriptionId ||
        subscription.asaasSubscriptionId.startsWith('manual_') ||
        subscription.asaasSubscriptionId.startsWith('trial_')
      ) {
        results.push({
          companyId: company.id,
          companyName: company.name,
          daysOverdue: 0,
          previousBlockLevel: company.blockLevel,
          newBlockLevel: company.blockLevel,
          action: 'skipped',
        });
        continue;
      }

      try {
        const asaasPayments =
          await this.asaasGateway.getAsaasSubscriptionPayments(
            subscription.asaasSubscriptionId,
          );

        if (!asaasPayments || asaasPayments.length === 0) {
          results.push({
            companyId: company.id,
            companyName: company.name,
            daysOverdue: 0,
            previousBlockLevel: company.blockLevel,
            newBlockLevel: company.blockLevel,
            action: 'skipped',
          });
          continue;
        }

        // Verificar se ainda há inadimplência
        const todayStr = new Date().toISOString().split('T')[0];
        const hasOverdue = asaasPayments.some(
          (p) =>
            p.status === 'OVERDUE' ||
            (p.status === 'PENDING' && p.dueDate < todayStr),
        );

        if (hasOverdue) {
          // Ainda inadimplente — manter bloqueio
          results.push({
            companyId: company.id,
            companyName: company.name,
            daysOverdue: 0,
            previousBlockLevel: company.blockLevel,
            newBlockLevel: company.blockLevel,
            action: 'unchanged',
          });
          continue;
        }

        // Não tem mais inadimplência — desbloquear!
        this.logger.log(
          `Empresa ${company.name} (${company.id}) não tem mais inadimplência no Asaas. Desbloqueando...`,
        );

        // Sincronizar payments faltantes do Asaas para o DB local
        await this.syncMissingPayments(
          subscription.id,
          subscription.asaasSubscriptionId,
          asaasPayments,
        );

        // Atualizar nextDueDate com o próximo pagamento PENDING
        const nextPending = asaasPayments.find(
          (p) => p.status === 'PENDING' && p.dueDate >= todayStr,
        );
        if (nextPending) {
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'ACTIVE',
              nextDueDate: new Date(nextPending.dueDate),
            },
          });
        } else {
          // Se não tem pending futuro, ao menos ativar
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: 'ACTIVE' },
          });
        }

        // Desbloquear empresa
        await this.unblockCompany(company.id);

        // Registrar no histórico
        await this.prisma.companyHistory.create({
          data: {
            companyId: company.id,
            action: 'UNBLOCKED',
            description: `Empresa desbloqueada automaticamente pelo cron (era ${company.blockLevel}). Pagamento confirmado no Asaas.`,
            changes: {
              before: {
                blockLevel: company.blockLevel,
                isActive: false,
              },
              after: { blockLevel: 'NONE', isActive: true },
            },
            createdByName: 'Sistema - Cron',
          },
        });

        results.push({
          companyId: company.id,
          companyName: company.name,
          daysOverdue: 0,
          previousBlockLevel: company.blockLevel,
          newBlockLevel: 'NONE',
          action: 'unblocked',
        });
      } catch (error) {
        this.logger.error(
          `Erro ao verificar desbloqueio de ${company.name}: ${error.message}. Pulando.`,
        );
        results.push({
          companyId: company.id,
          companyName: company.name,
          daysOverdue: 0,
          previousBlockLevel: company.blockLevel,
          newBlockLevel: company.blockLevel,
          action: 'skipped',
        });
      }
    }

    return results;
  }

  /**
   * Sincroniza payments do Asaas que não existem no DB local.
   */
  private async syncMissingPayments(
    localSubscriptionId: string,
    asaasSubscriptionId: string,
    asaasPayments: any[],
  ): Promise<void> {
    for (const asaasPayment of asaasPayments) {
      // Verificar se já existe no DB local
      const exists = await this.prisma.payment.findFirst({
        where: { asaasPaymentId: asaasPayment.id },
      });

      if (exists) {
        // Atualizar status se mudou
        const mappedStatus = this.mapAsaasStatus(asaasPayment.status);
        if (exists.status !== mappedStatus) {
          await this.prisma.payment.update({
            where: { id: exists.id },
            data: {
              status: mappedStatus,
              confirmedDate: asaasPayment.confirmedDate
                ? new Date(asaasPayment.confirmedDate)
                : exists.confirmedDate,
              paymentDate: asaasPayment.paymentDate
                ? new Date(asaasPayment.paymentDate)
                : exists.paymentDate,
              invoiceUrl: asaasPayment.invoiceUrl || exists.invoiceUrl,
              bankSlipUrl: asaasPayment.bankSlipUrl || exists.bankSlipUrl,
            },
          });
          this.logger.log(
            `Payment ${exists.id} atualizado: ${exists.status} -> ${mappedStatus}`,
          );
        }
        continue;
      }

      // Criar payment que não existe
      const mappedStatus = this.mapAsaasStatus(asaasPayment.status);
      await this.prisma.payment.create({
        data: {
          subscriptionId: localSubscriptionId,
          asaasPaymentId: asaasPayment.id,
          asaasCustomerId: asaasPayment.customer,
          value: asaasPayment.value,
          dueDate: new Date(asaasPayment.dueDate),
          billingType: asaasPayment.billingType || 'PIX',
          status: mappedStatus,
          description: asaasPayment.description || 'Assinatura',
          invoiceUrl: asaasPayment.invoiceUrl,
          bankSlipUrl: asaasPayment.bankSlipUrl,
          confirmedDate: asaasPayment.confirmedDate
            ? new Date(asaasPayment.confirmedDate)
            : null,
          paymentDate: asaasPayment.paymentDate
            ? new Date(asaasPayment.paymentDate)
            : null,
        },
      });

      this.logger.log(
        `Payment criado localmente: ${asaasPayment.id} (${mappedStatus}, due: ${asaasPayment.dueDate})`,
      );
    }
  }

  /**
   * Mapeia status do Asaas para status local
   */
  private mapAsaasStatus(asaasStatus: string): AsaasPaymentStatus {
    const statusMap: Record<string, AsaasPaymentStatus> = {
      PENDING: 'PENDING',
      CONFIRMED: 'CONFIRMED',
      RECEIVED: 'CONFIRMED',
      RECEIVED_IN_CASH: 'CONFIRMED',
      OVERDUE: 'OVERDUE',
      REFUNDED: 'REFUNDED',
    };
    return statusMap[asaasStatus] || 'PENDING';
  }

  /**
   * Desbloqueia uma empresa (após pagamento confirmado)
   */
  async unblockCompany(companyId: string): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        blockLevel: 'NONE',
        blockedAt: null,
        blockReason: null,
        isActive: true,
      },
    });

    this.logger.log(`Empresa ${companyId} desbloqueada automaticamente`);
  }

  /**
   * Desbloqueio manual por admin
   */
  async manualUnblock(companyId: string, adminUserId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, blockLevel: true },
    });

    if (!company) {
      throw new ForbiddenException('Empresa não encontrada');
    }

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        blockLevel: 'NONE',
        blockedAt: null,
        blockReason: null,
        isActive: true,
      },
    });

    // Registrar no histórico
    await this.prisma.companyHistory.create({
      data: {
        companyId,
        action: 'UNBLOCK',
        description: `Empresa desbloqueada manualmente (era ${company.blockLevel})`,
        createdBy: adminUserId,
      },
    });

    this.logger.log(
      `Empresa ${companyId} desbloqueada manualmente por admin ${adminUserId}`,
    );
  }

  /**
   * Retorna status de bloqueio de uma empresa
   */
  async getBlockStatus(companyId: string): Promise<{
    blockLevel: BlockLevel;
    blockedAt: Date | null;
    blockReason: string | null;
  }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        blockLevel: true,
        blockedAt: true,
        blockReason: true,
      },
    });

    if (!company) {
      throw new ForbiddenException('Empresa não encontrada');
    }

    return company;
  }

  /**
   * Lista empresas bloqueadas (para admin)
   */
  async listBlockedCompanies(blockLevel?: BlockLevel): Promise<any[]> {
    const where: any = {
      blockLevel: blockLevel || { in: ['PARTIAL', 'FULL'] },
    };

    return this.prisma.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        blockLevel: true,
        blockedAt: true,
        blockReason: true,
        Subscription: {
          where: { status: 'ACTIVE' },
          select: {
            nextDueDate: true,
            value: true,
            plan: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { blockedAt: 'desc' },
    });
  }

  /**
   * Obtém a URL de pagamento pendente para uma empresa bloqueada
   * Utiliza invoiceUrl, bankSlipUrl, ou constrói URL a partir do asaasPaymentId
   */
  async getPendingPaymentUrl(
    companyId: string,
  ): Promise<{ paymentUrl: string | null; dueDate: Date | null }> {
    this.logger.log(`Getting pending payment URL for company: ${companyId}`);

    // 1. Find the oldest pending/overdue payment for this company
    const payment = await this.prisma.payment.findFirst({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        subscription: {
          companyId,
        },
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        invoiceUrl: true,
        bankSlipUrl: true,
        asaasPaymentId: true,
        dueDate: true,
        subscription: {
          select: {
            asaasSubscriptionId: true,
          },
        },
      },
    });

    if (payment) {
      this.logger.log(`Pending payment found: ${payment.asaasPaymentId}`);

      // Priority: local invoiceUrl > local bankSlipUrl
      let paymentUrl = payment.invoiceUrl || payment.bankSlipUrl;

      // If no local URLs, fetch live from Asaas API and cache
      if (!paymentUrl && payment.subscription?.asaasSubscriptionId) {
        this.logger.log(
          `No local URL. Fetching from Asaas API for subscription: ${payment.subscription.asaasSubscriptionId}`,
        );

        try {
          const asaasPayments =
            await this.asaasGateway.getAsaasSubscriptionPayments(
              payment.subscription.asaasSubscriptionId,
            );

          // Find the matching payment by asaasPaymentId
          const asaasPayment = asaasPayments.find(
            (p) => p.id === payment.asaasPaymentId,
          );

          if (asaasPayment) {
            paymentUrl = asaasPayment.invoiceUrl || asaasPayment.bankSlipUrl;

            // Cache the URLs in the DB for next time
            if (asaasPayment.invoiceUrl || asaasPayment.bankSlipUrl) {
              await this.prisma.payment.update({
                where: { id: payment.id },
                data: {
                  invoiceUrl: asaasPayment.invoiceUrl || undefined,
                  bankSlipUrl: asaasPayment.bankSlipUrl || undefined,
                },
              });
              this.logger.log(
                `Cached Asaas URLs in DB: invoiceUrl=${asaasPayment.invoiceUrl || 'N/A'}, bankSlipUrl=${asaasPayment.bankSlipUrl || 'N/A'}`,
              );
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch from Asaas API: ${error.message}`);
        }
      }

      // Final fallback: subscription portal URL
      if (!paymentUrl && payment.subscription?.asaasSubscriptionId) {
        paymentUrl = `https://www.asaas.com/c/${payment.subscription.asaasSubscriptionId}`;
        this.logger.log(
          `Using subscription portal URL as fallback: ${paymentUrl}`,
        );
      }

      this.logger.log(`Final paymentUrl: ${paymentUrl || 'NULL'}`);

      return {
        paymentUrl: paymentUrl || null,
        dueDate: payment.dueDate || null,
      };
    }

    // 2. No pending payment - fallback to latest subscription portal
    this.logger.log(`No pending payment found. Checking fallback portal.`);

    const latestSubscription = await this.prisma.subscription.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: { asaasSubscriptionId: true },
    });

    if (latestSubscription?.asaasSubscriptionId) {
      const fallbackUrl = `https://www.asaas.com/c/${latestSubscription.asaasSubscriptionId}`;
      this.logger.log(`Using fallback portal URL: ${fallbackUrl}`);
      return {
        paymentUrl: fallbackUrl,
        dueDate: null,
      };
    }

    this.logger.log(`No subscription found at all. Returning null.`);
    return {
      paymentUrl: null,
      dueDate: null,
    };
  }
}
