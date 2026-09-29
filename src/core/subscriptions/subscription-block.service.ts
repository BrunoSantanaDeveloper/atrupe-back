import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BlockLevel, AsaasPaymentStatus, BillingType } from '@prisma/client';
import { AsaasGatewayService } from './asaas-gateway.service';
import { isBilledByGateway, isInstallmentBilling } from './billing-mode';

export interface BlockCheckResult {
  companyId: string;
  companyName: string;
  daysOverdue: number;
  previousBlockLevel: BlockLevel;
  newBlockLevel: BlockLevel;
  action:
    | 'blocked'
    | 'upgraded'
    | 'unchanged'
    | 'skipped'
    | 'unblocked'
    | 'ended';
}

@Injectable()
export class SubscriptionBlockService {
  private readonly logger = new Logger(SubscriptionBlockService.name);

  // Regras de bloqueio (dias de atraso)
  private readonly DAYS_FOR_PARTIAL_BLOCK = 3;
  // Contrato 1.1, cláusula 7.4: bloqueio total "após 6 (seis) dias corridos do
  // vencimento" — a partir do 7º dia de atraso. De 3 a 6 dias o bloqueio é
  // parcial: fecha o que cria obrigação nova, mas a pessoa ainda entra e
  // regulariza.
  private readonly DAYS_FOR_FULL_BLOCK = 7;

  // Flag para ativar/desativar o cron de bloqueio
  private readonly isCronActive = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly asaasGateway: AsaasGatewayService,
  ) {}

  /**
   * Encerra a assinatura local quando a do Asaas foi removida, inativada ou
   * expirou: sem ela, nada cobra, e a conta seguiria liberada de graça. As
   * mensalidades locais em aberto vão junto — elas não existem mais no Asaas,
   * e deixá-las pedindo regularização travaria uma recontratação.
   *
   * Só a assinatura recorrente; o anual parcelado não tem assinatura no
   * Asaas. Falha na consulta não encerra nada.
   */
  async endIfRemovedFromGateway(subscription: {
    id: string;
    asaasSubscriptionId: string;
    asaasInstallmentId?: string | null;
  }): Promise<boolean> {
    if (
      subscription.asaasInstallmentId ||
      !subscription.asaasSubscriptionId.startsWith('sub_')
    ) {
      return false;
    }

    let remote: Awaited<
      ReturnType<AsaasGatewayService['getAsaasSubscription']>
    >;
    try {
      remote = await this.asaasGateway.getAsaasSubscription(
        subscription.asaasSubscriptionId,
      );
    } catch (error) {
      this.logger.warn(
        `Assinatura ${subscription.asaasSubscriptionId} não consultada no Asaas: ${error.message}`,
      );
      return false;
    }
    const gone =
      !remote ||
      remote.deleted === true ||
      remote.status === 'INACTIVE' ||
      remote.status === 'EXPIRED';
    if (!gone) return false;

    const reason = !remote
      ? 'não existe no Asaas'
      : remote.deleted
        ? 'foi removida no Asaas'
        : `está ${remote.status} no Asaas`;
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELED', endedReason: 'GATEWAY_REMOVED' },
      });
      await tx.payment.updateMany({
        where: {
          subscriptionId: subscription.id,
          status: { in: ['PENDING', 'OVERDUE'] },
        },
        data: { status: 'CANCELED' },
      });
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: subscription.id,
          action: 'CANCELED',
          description: `Assinatura encerrada: a cobrança ${reason}, e a conta não pode seguir liberada sem cobrança.`,
          changes: {
            before: { status: 'ACTIVE' },
            after: { status: 'CANCELED' },
          },
          metadata: {
            reason: 'GATEWAY_REMOVED',
            asaasSubscriptionId: subscription.asaasSubscriptionId,
            asaasStatus: remote ? remote.status : null,
            asaasDeleted: remote ? !!remote.deleted : null,
          },
          createdByName: 'Sistema',
        },
      });
    });
    this.logger.warn(
      `Assinatura ${subscription.id} encerrada: a ${subscription.asaasSubscriptionId} ${reason}.`,
    );
    return true;
  }

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
      // 0. Sincronizar TODOS os payments do Asaas antes de avaliar bloqueios
      await this.syncAllCompanyPayments();

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
   * Sincroniza TODOS os payments do Asaas para TODAS as empresas com subscription ativa.
   * Funciona como substituto do webhook: puxa cobranças novas e atualiza status/URLs.
   */
  private async syncAllCompanyPayments(): Promise<void> {
    this.logger.log('Iniciando sync de TODOS os payments do Asaas...');

    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        OR: [
          { asaasSubscriptionId: { startsWith: 'sub_' } },
          // O anual parcelado não tem assinatura no Asaas: as cobranças são as
          // parcelas do parcelamento em curso.
          { asaasInstallmentId: { not: null } },
        ],
        status: { in: ['ACTIVE', 'EXPIRED', 'BLOCKED', 'INACTIVE'] },
      },
      select: {
        id: true,
        asaasSubscriptionId: true,
        asaasInstallmentId: true,
        Company: { select: { name: true } },
      },
    });

    this.logger.log(
      `Encontradas ${subscriptions.length} subscriptions Asaas para sincronizar`,
    );

    let totalSynced = 0;
    let totalErrors = 0;

    for (const sub of subscriptions) {
      try {
        const asaasPayments = await this.asaasGateway.getChargesOf(sub);

        if (asaasPayments.length > 0) {
          await this.syncMissingPayments(
            sub.id,
            sub.asaasSubscriptionId!,
            asaasPayments,
          );
          totalSynced++;
        }
      } catch (error) {
        totalErrors++;
        this.logger.warn(
          `Falha ao sincronizar payments de ${sub.Company?.name || sub.id}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Sync completo: ${totalSynced} subscriptions sincronizadas, ${totalErrors} erros`,
    );
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
            id: true,
            asaasSubscriptionId: true,
            asaasInstallmentId: true,
            billingMode: true,
            nextDueDate: true,
          },
        },
      },
    });

    for (const company of companiesWithSubscriptions) {
      // A assinatura cobrada pelo Asaas, não a primeira da lista: com um teste
      // gratuito esquecido como ativo, pegar o [0] deixava a paga sem
      // conferência.
      const subscription =
        company.Subscription.find((s) => isBilledByGateway(s)) ??
        company.Subscription[0];
      if (!subscription) continue;

      // Pular subscriptions sem vínculo real com Asaas (manual, trial, test)
      if (!isBilledByGateway(subscription)) {
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

      // Assinatura removida no Asaas: nada cobra, e a conta ficaria liberada
      // sem pagar. O aviso de remoção encerra pelo webhook; isto cobre o que
      // ele não trouxe. A lista de cobranças não basta para saber — a de uma
      // assinatura removida ainda traz as já pagas.
      if (await this.endIfRemovedFromGateway(subscription)) {
        results.push({
          companyId: company.id,
          companyName: company.name,
          daysOverdue: 0,
          previousBlockLevel: company.blockLevel,
          newBlockLevel: company.blockLevel,
          action: 'ended',
        });
        continue;
      }

      // Consultar pagamentos diretamente no Asaas
      let daysOverdue = 0;
      try {
        const asaasPayments =
          await this.asaasGateway.getChargesOf(subscription);

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
        // A MAIS ANTIGA entre as vencidas, não a primeira que a listagem
        // devolver: pegando qualquer uma, o atraso saía subestimado e o
        // bloqueio demorava mais do que devia. Datas vêm como "AAAA-MM-DD",
        // então a ordenação de texto já é cronológica.
        const overduePayment = asaasPayments
          .filter(
            (p) =>
              p.status === 'OVERDUE' ||
              (p.status === 'PENDING' && p.dueDate < todayStr),
          )
          .sort((a, b) =>
            String(a.dueDate).localeCompare(String(b.dueDate)),
          )[0];

        if (overduePayment) {
          // "AAAA-MM-DD" lido por new Date() vira meia-noite UTC; nivelar isso
          // para meia-noite local somava um dia inteiro ao atraso em fusos
          // negativos, e as empresas eram bloqueadas um dia antes da regra.
          // Montar a data pelas partes mantém a contagem exata.
          const [ano, mes, dia] = String(overduePayment.dueDate)
            .split('-')
            .map(Number);
          const dueDate = new Date(ano, mes - 1, dia);
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
        blockReason: true,
        Subscription: {
          where: {
            plan: { planType: { not: 'TRIAL' } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            asaasSubscriptionId: true,
            asaasInstallmentId: true,
            billingMode: true,
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

      // Pular empresas bloqueadas MANUALMENTE por admin.
      // Bloqueio manual é identificado pelo blockReason — não deve ser
      // desfeito automaticamente pelo cron, apenas via ação do admin no painel.
      if (
        company.blockReason &&
        (company.blockReason.startsWith('Inativação manual') ||
          company.blockReason.startsWith('Bloqueio manual'))
      ) {
        this.logger.log(
          `Empresa ${company.name} ignorada pelo cron: bloqueio/inativação manual (${company.blockReason})`,
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

      // Pular subscriptions sem vínculo real com Asaas
      if (!isBilledByGateway(subscription)) {
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
          await this.asaasGateway.getChargesOf(subscription);

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

        // Atualizar nextDueDate com o próximo pagamento PENDING. No anual
        // parcelado, a próxima parcela não é o próximo vencimento: ele é a
        // renovação, que já está na assinatura.
        const nextPending = isInstallmentBilling(subscription)
          ? null
          : asaasPayments.find(
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
    const validBillingTypes = [
      'CREDIT_CARD',
      'BOLETO',
      'PIX',
      'DEBIT_CARD',
      'TRANSFER',
      'DEPOSIT',
    ];
    const mapBillingType = (type: string): BillingType =>
      (validBillingTypes.includes(type) ? type : 'PIX') as BillingType;

    for (const asaasPayment of asaasPayments) {
      // Verificar se já existe no DB local
      const exists = await this.prisma.payment.findFirst({
        where: { asaasPaymentId: asaasPayment.id },
      });

      if (exists) {
        // Sempre atualizar: status, invoiceUrl, bankSlipUrl
        const mappedStatus = this.mapAsaasStatus(asaasPayment.status);
        const needsUpdate =
          exists.status !== mappedStatus ||
          (!exists.invoiceUrl && asaasPayment.invoiceUrl) ||
          (!exists.bankSlipUrl && asaasPayment.bankSlipUrl);

        if (needsUpdate) {
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
            `Payment ${exists.id} atualizado: status=${mappedStatus}, invoiceUrl=${asaasPayment.invoiceUrl ? 'YES' : 'kept'}`,
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
          billingType: mapBillingType(asaasPayment.billingType),
          status: mappedStatus,
          description: asaasPayment.description || 'Assinatura',
          invoiceUrl: asaasPayment.invoiceUrl,
          bankSlipUrl: asaasPayment.bankSlipUrl,
          asaasInstallmentId: asaasPayment.installment ?? null,
          installmentNumber: asaasPayment.installmentNumber ?? null,
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
    return this.asaasGateway.mapAsaasPaymentStatus(asaasStatus);
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
   * Obtém a URL de pagamento (invoiceUrl) para uma empresa bloqueada.
   * Sempre busca do Asaas API para garantir URL atualizada.
   * Retorna APENAS URLs no padrão /i/ (invoice). Nunca /c/ (portal).
   */
  async getPendingPaymentUrl(
    companyId: string,
  ): Promise<{ paymentUrl: string | null; dueDate: Date | null }> {
    this.logger.log(`Getting pending payment URL for company: ${companyId}`);

    // Buscar subscription ativa com asaasSubscriptionId real
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        OR: [
          { asaasSubscriptionId: { startsWith: 'sub_' } },
          { asaasInstallmentId: { not: null } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, asaasSubscriptionId: true, asaasInstallmentId: true },
    });

    if (!subscription?.asaasSubscriptionId) {
      this.logger.warn(
        `Nenhuma subscription Asaas encontrada para empresa ${companyId}`,
      );
      return { paymentUrl: null, dueDate: null };
    }

    // Buscar payments DIRETAMENTE do Asaas (source of truth)
    try {
      const asaasPayments = await this.asaasGateway.getChargesOf(subscription);

      // Encontrar o payment pendente/overdue mais antigo
      const pendingPayment = asaasPayments
        .filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE')
        .sort(
          (a, b) =>
            new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
        )[0];

      if (pendingPayment?.invoiceUrl) {
        this.logger.log(
          `invoiceUrl encontrada no Asaas: ${pendingPayment.invoiceUrl}`,
        );

        // Cachear no DB local para consultas futuras
        const localPayment = await this.prisma.payment.findFirst({
          where: { asaasPaymentId: pendingPayment.id },
        });

        if (localPayment && !localPayment.invoiceUrl) {
          await this.prisma.payment.update({
            where: { id: localPayment.id },
            data: {
              invoiceUrl: pendingPayment.invoiceUrl,
              bankSlipUrl: pendingPayment.bankSlipUrl || undefined,
            },
          });
          this.logger.log(
            `invoiceUrl cacheada no DB para payment ${localPayment.id}`,
          );
        }

        return {
          paymentUrl: pendingPayment.invoiceUrl,
          dueDate: new Date(pendingPayment.dueDate),
        };
      }

      // Se Asaas retornou o payment mas sem invoiceUrl, logar erro
      if (pendingPayment) {
        this.logger.error(
          `Payment ${pendingPayment.id} existe no Asaas mas NÃO tem invoiceUrl. Status: ${pendingPayment.status}`,
        );
      } else {
        this.logger.log(`Nenhum payment pendente/overdue encontrado no Asaas`);
      }
    } catch (error) {
      this.logger.error(`Falha ao buscar payments do Asaas: ${error.message}`);
    }

    // Fallback: checar DB local (pode ter sido cacheado anteriormente)
    const localPayment = await this.prisma.payment.findFirst({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        subscription: { companyId },
        invoiceUrl: { not: null },
      },
      orderBy: { dueDate: 'asc' },
      select: { invoiceUrl: true, dueDate: true },
    });

    if (localPayment?.invoiceUrl) {
      this.logger.log(
        `Usando invoiceUrl do cache local: ${localPayment.invoiceUrl}`,
      );
      return {
        paymentUrl: localPayment.invoiceUrl,
        dueDate: localPayment.dueDate,
      };
    }

    this.logger.error(
      `FALHA: Nenhuma invoiceUrl disponível para empresa ${companyId}. Possível falha de sincronização.`,
    );
    return { paymentUrl: null, dueDate: null };
  }
}
