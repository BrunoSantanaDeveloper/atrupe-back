import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BlockLevel } from '@prisma/client';

export interface BlockCheckResult {
  companyId: string;
  companyName: string;
  daysOverdue: number;
  previousBlockLevel: BlockLevel;
  newBlockLevel: BlockLevel;
  action: 'blocked' | 'upgraded' | 'unchanged';
}

@Injectable()
export class SubscriptionBlockService {
  private readonly logger = new Logger(SubscriptionBlockService.name);

  // Regras de bloqueio (dias de atraso)
  private readonly DAYS_FOR_PARTIAL_BLOCK = 3;
  private readonly DAYS_FOR_FULL_BLOCK = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cron job executado diariamente às 6h para verificar atrasos
   */
  @Cron('0 6 * * *', {
    name: 'subscription-block-check',
    timeZone: 'America/Sao_Paulo',
  })
  async handleCron(): Promise<void> {
    this.logger.log('Iniciando verificação de bloqueios de assinatura...');

    try {
      const results = await this.checkAndApplyBlocks();

      const blocked = results.filter((r) => r.action !== 'unchanged');
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
   * Verifica todas as empresas com assinaturas ativas e aplica bloqueios conforme atraso
   */
  async checkAndApplyBlocks(): Promise<BlockCheckResult[]> {
    const results: BlockCheckResult[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Buscar empresas com assinaturas ativas e pagamentos pendentes/atrasados
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
            nextDueDate: true,
            payments: {
              where: {
                status: { in: ['PENDING', 'OVERDUE'] },
              },
              orderBy: { dueDate: 'asc' },
              take: 1,
              select: {
                dueDate: true,
                status: true,
              },
            },
          },
        },
      },
    });

    for (const company of companiesWithSubscriptions) {
      const subscription = company.Subscription[0];
      if (!subscription) continue;

      // Calcular dias de atraso
      const oldestPendingPayment = subscription.payments[0];
      let daysOverdue = 0;

      if (oldestPendingPayment) {
        const dueDate = new Date(oldestPendingPayment.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        daysOverdue = Math.floor(
          (today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
      } else {
        // Verificar nextDueDate da subscription
        const nextDue = new Date(subscription.nextDueDate);
        nextDue.setHours(0, 0, 0, 0);
        if (today > nextDue) {
          daysOverdue = Math.floor(
            (today.getTime() - nextDue.getTime()) / (1000 * 60 * 60 * 24),
          );
        }
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
            blockReason: `Assinatura com ${daysOverdue} dias de atraso`,
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
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: 'ACTIVE',
      },
      select: {
        payments: {
          where: {
            status: { in: ['PENDING', 'OVERDUE'] },
          },
          orderBy: { dueDate: 'asc' },
          take: 1,
          select: {
            invoiceUrl: true,
            bankSlipUrl: true,
            asaasPaymentId: true,
            dueDate: true,
          },
        },
      },
    });

    const payment = subscription?.payments?.[0];

    if (!payment) {
      return {
        paymentUrl: null,
        dueDate: null,
      };
    }

    // Prioridade: invoiceUrl > bankSlipUrl > URL construída com asaasPaymentId
    let paymentUrl = payment.invoiceUrl || payment.bankSlipUrl;

    // Se não tiver URLs salvas, construir URL do Asaas
    if (!paymentUrl && payment.asaasPaymentId) {
      // URL padrão do Asaas para visualizar cobrança
      paymentUrl = `https://www.asaas.com/i/${payment.asaasPaymentId}`;
    }

    return {
      paymentUrl: paymentUrl || null,
      dueDate: payment.dueDate || null,
    };
  }
}
