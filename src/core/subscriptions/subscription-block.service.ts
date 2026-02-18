import {
  Injectable,
  Logger,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BlockLevel } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';

export interface BlockCheckResult {
  companyId: string;
  companyName: string;
  daysOverdue: number;
  previousBlockLevel: BlockLevel;
  newBlockLevel: BlockLevel;
  action: 'blocked' | 'upgraded' | 'unchanged' | 'skipped';
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
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
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
      const results = await this.checkAndApplyBlocks();

      const blocked = results.filter(
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
          await this.subscriptionsService.getAsaasSubscriptionPayments(
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
    console.log(
      `[SubscriptionBlockService] Getting pending payment URL for company: ${companyId}`,
    );

    // 1. Find the oldest pending/overdue payment for this company (searching all its subscriptions)
    const payment = await this.prisma.payment.findFirst({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        subscription: {
          companyId,
        },
      },
      orderBy: { dueDate: 'asc' },
      select: {
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
      console.log(
        `[SubscriptionBlockService] Pending payment found: ${payment.asaasPaymentId}`,
      );
      console.log(
        `[SubscriptionBlockService] - invoiceUrl: ${payment.invoiceUrl || 'N/A'}`,
      );
      console.log(
        `[SubscriptionBlockService] - bankSlipUrl: ${payment.bankSlipUrl || 'N/A'}`,
      );

      // Priority: invoiceUrl > bankSlipUrl > constructed URL with asaasPaymentId
      let paymentUrl = payment.invoiceUrl || payment.bankSlipUrl;

      // If no saved URLs, construct Asaas URL
      if (!paymentUrl && payment.asaasPaymentId) {
        paymentUrl = `https://www.asaas.com/i/${payment.asaasPaymentId}`;
        console.log(
          `[SubscriptionBlockService] Constructed payment URL: ${paymentUrl}`,
        );
      }

      // Ultimate fallback: use subscription's Asaas portal
      if (!paymentUrl && payment.subscription?.asaasSubscriptionId) {
        paymentUrl = `https://www.asaas.com/c/${payment.subscription.asaasSubscriptionId}`;
        console.log(
          `[SubscriptionBlockService] Using payment's subscription portal URL: ${paymentUrl}`,
        );
      }

      console.log(
        `[SubscriptionBlockService] Final paymentUrl: ${paymentUrl || 'NULL'}`,
      );

      return {
        paymentUrl: paymentUrl || null,
        dueDate: payment.dueDate || null,
      };
    }

    // 2. If no pending payment found, fallback to the portal link of the LATEST subscription
    console.log(
      `[SubscriptionBlockService] No pending payment found across all subscriptions. Checking fallback portal.`,
    );

    const latestSubscription = await this.prisma.subscription.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: { asaasSubscriptionId: true },
    });

    if (latestSubscription?.asaasSubscriptionId) {
      const fallbackUrl = `https://www.asaas.com/c/${latestSubscription.asaasSubscriptionId}`;
      console.log(
        `[SubscriptionBlockService] Using fallback portal URL from latest sub: ${fallbackUrl}`,
      );
      return {
        paymentUrl: fallbackUrl,
        dueDate: null,
      };
    }

    console.log(
      `[SubscriptionBlockService] No subscription or asaasSubscriptionId found at all. Returning null.`,
    );
    return {
      paymentUrl: null,
      dueDate: null,
    };
  }
}
