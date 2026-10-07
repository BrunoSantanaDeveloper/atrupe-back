import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  BlockLevel,
  AsaasPaymentStatus,
  BillingType,
  Payment,
  Prisma,
} from '@prisma/client';
import { AsaasGatewayService } from './asaas-gateway.service';
import { AsaasPaymentResponse } from './interfaces/asaas.interfaces';
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

export type ChargeRefreshResult =
  /** Removida ou inexistente no Asaas: a pendência local foi baixada. */
  | 'canceled'
  /** Status e links alinhados ao Asaas. */
  | 'updated'
  | 'unchanged'
  /** Sem registro aqui: a conta do Asaas é compartilhada com o sistema antigo. */
  | 'not_local';

/** Quem disparou a sincronização — vai para o histórico da assinatura. */
export interface SyncActor {
  id: string | null;
  name: string;
}

const SYSTEM_ACTOR: SyncActor = { id: null, name: 'Sistema' };

/** O que alinhar entre as cobranças locais de uma assinatura e o Asaas. */
interface ChargeSyncPlan {
  /** No Asaas e não aqui. */
  create: any[];
  /** Aqui com status ou link diferente do Asaas. */
  update: { local: Payment; remote: any; status: AsaasPaymentStatus }[];
  /** Em aberto aqui, removida ou inexistente no Asaas. */
  cancel: { local: Payment; remote: AsaasPaymentResponse | null }[];
}

export interface ChargeSyncCounts {
  created: number;
  updated: number;
  canceled: number;
}

/**
 * Uma cobrança em que o banco e o Asaas discordam, como o superadmin a vê
 * antes de sincronizar. Link que só falta aqui não conta como divergência:
 * é preenchido na sincronização, mas não muda nada para o cliente.
 */
export interface ChargeDivergence {
  asaasPaymentId: string;
  /** YYYY-MM-DD */
  dueDate: string;
  value: number;
  /** Nulo quando a cobrança só existe no Asaas. */
  localStatus: AsaasPaymentStatus | null;
  /** No vocabulário local; REMOVED quando removida ou inexistente no Asaas. */
  asaasStatus: AsaasPaymentStatus | 'REMOVED';
  action: 'create' | 'update' | 'cancel';
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
   * Alinha uma cobrança local ao que o Asaas diz dela, consultando-a pelo id.
   *
   * A listagem de cobranças da assinatura não traz as removidas: uma
   * mensalidade cancelada no Asaas (ex.: perdoada numa reativação) sumia da
   * listagem, nunca mais era revisitada e ficava OVERDUE aqui para sempre. A
   * rotina de bloqueio olha o Asaas ao vivo e não bloqueava — mas a sessão, a
   * regularização, a evolução e a transferência leem o banco e viam um débito
   * que não existe.
   *
   * Removida ou inexistente no Asaas, a pendência local vira CANCELED (cobrança
   * paga nunca é tocada). Com `onlyIfRemoved`, é só isso; sem ele, vale o
   * status do Asaas — o que reabre uma cobrança restaurada lá. Falha na
   * consulta lança erro e não altera nada.
   */
  async refreshLocalCharge(
    asaasPaymentId: string,
    options: { onlyIfRemoved?: boolean } = {},
  ): Promise<ChargeRefreshResult> {
    const local = await this.prisma.payment.findUnique({
      where: { asaasPaymentId },
    });
    if (!local) return 'not_local';

    const remote = await this.asaasGateway.getAsaasPayment(asaasPaymentId);

    if (!remote || remote.deleted === true) {
      if (local.status !== 'PENDING' && local.status !== 'OVERDUE') {
        return 'unchanged';
      }
      await this.cancelRemovedCharge(local, remote, SYSTEM_ACTOR);
      return 'canceled';
    }

    if (options.onlyIfRemoved) return 'unchanged';

    const status = this.mapAsaasStatus(remote.status);
    const needsUpdate =
      local.status !== status ||
      (!local.invoiceUrl && !!remote.invoiceUrl) ||
      (!local.bankSlipUrl && !!remote.bankSlipUrl);
    if (!needsUpdate) return 'unchanged';

    await this.prisma.payment.update({
      where: { id: local.id },
      data: {
        status,
        confirmedDate: remote.confirmedDate
          ? new Date(remote.confirmedDate)
          : local.confirmedDate,
        paymentDate: remote.paymentDate
          ? new Date(remote.paymentDate)
          : local.paymentDate,
        invoiceUrl: remote.invoiceUrl || local.invoiceUrl,
        bankSlipUrl: remote.bankSlipUrl || local.bankSlipUrl,
      },
    });
    this.logger.log(
      `Cobrança ${asaasPaymentId} alinhada ao Asaas: ${local.status} → ${status}`,
    );
    return 'updated';
  }

  /**
   * Baixa a pendência local de uma cobrança removida (ou inexistente) no
   * Asaas, deixando no histórico da assinatura o motivo e quem disparou.
   */
  private async cancelRemovedCharge(
    local: Payment,
    remote: AsaasPaymentResponse | null,
    actor: SyncActor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: local.id },
        data: { status: 'CANCELED' },
      });
      if (local.subscriptionId) {
        await tx.subscriptionHistory.create({
          data: {
            subscriptionId: local.subscriptionId,
            action: 'PAYMENT_CANCELED',
            description: `Cobrança de ${this.formatDay(local.dueDate)} (R$ ${local.value.toFixed(2).replace('.', ',')}) ${remote ? 'foi removida' : 'não existe'} no Asaas; a pendência local foi baixada.`,
            changes: {
              before: { status: local.status },
              after: { status: 'CANCELED' },
            },
            metadata: {
              reason: 'GATEWAY_REMOVED',
              asaasPaymentId: local.asaasPaymentId,
              asaasDeleted: remote ? true : null,
            },
            createdBy: actor.id,
            createdByName: actor.name,
          },
        });
      }
    });
    this.logger.warn(
      `Cobrança ${local.asaasPaymentId} (${this.formatDay(local.dueDate)}) ${remote ? 'removida' : 'inexistente'} no Asaas: pendência local ${local.status} → CANCELED (${actor.name})`,
    );
  }

  /** Vencimento gravado à meia-noite UTC do dia: lido em UTC, sem trocar de dia. */
  private formatDay(date: Date): string {
    return date.toISOString().slice(0, 10).split('-').reverse().join('/');
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
      where: this.syncableSubscriptions(),
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

        // Mesmo com a listagem vazia: as cobranças locais em aberto podem ter
        // sido removidas no Asaas, e é o sync que as confere.
        await this.syncMissingPayments(
          sub.id,
          sub.asaasSubscriptionId!,
          asaasPayments,
        );
        totalSynced++;
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
   * As assinaturas que o sync confere: vinculadas ao Asaas (a recorrente, ou o
   * anual parcelado, cujas cobranças são as parcelas do parcelamento em curso)
   * e não encerradas. É o mesmo conjunto na rotina das 03:00 e no
   * "Sincronizar com Asaas" do superadmin.
   */
  private syncableSubscriptions(
    companyId?: string,
  ): Prisma.SubscriptionWhereInput {
    return {
      ...(companyId ? { companyId } : {}),
      OR: [
        { asaasSubscriptionId: { startsWith: 'sub_' } },
        { asaasInstallmentId: { not: null } },
      ],
      status: { in: ['ACTIVE', 'EXPIRED', 'BLOCKED', 'INACTIVE'] },
    };
  }

  private syncableSubscriptionsOf(companyId: string) {
    return this.prisma.subscription.findMany({
      where: this.syncableSubscriptions(companyId),
      select: { id: true, asaasSubscriptionId: true, asaasInstallmentId: true },
    });
  }

  /**
   * O que o "Sincronizar com Asaas" mudaria nas cobranças da empresa — o mesmo
   * plano que `syncCompanyCharges` aplica. Só lê.
   */
  async previewCompanyCharges(companyId: string): Promise<ChargeDivergence[]> {
    const divergences: ChargeDivergence[] = [];

    for (const sub of await this.syncableSubscriptionsOf(companyId)) {
      const listed = await this.asaasGateway.getChargesOf(sub);
      const plan = await this.planChargeSync(sub.id, listed);

      for (const remote of plan.create) {
        divergences.push({
          asaasPaymentId: remote.id,
          dueDate: String(remote.dueDate).slice(0, 10),
          value: remote.value,
          localStatus: null,
          asaasStatus: this.mapAsaasStatus(remote.status),
          action: 'create',
        });
      }
      for (const { local, status } of plan.update) {
        if (local.status === status) continue; // só um link a preencher
        divergences.push({
          asaasPaymentId: local.asaasPaymentId,
          dueDate: local.dueDate.toISOString().slice(0, 10),
          value: local.value,
          localStatus: local.status,
          asaasStatus: status,
          action: 'update',
        });
      }
      for (const { local } of plan.cancel) {
        divergences.push({
          asaasPaymentId: local.asaasPaymentId,
          dueDate: local.dueDate.toISOString().slice(0, 10),
          value: local.value,
          localStatus: local.status,
          asaasStatus: 'REMOVED',
          action: 'cancel',
        });
      }
    }

    return divergences.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  /**
   * O alinhamento da rotina das 03:00, na hora, para uma empresa. Asaas sem
   * resposta interrompe com erro; o que já foi alinhado fica (cada assinatura
   * é alinhada por inteiro, e repetir é seguro).
   */
  async syncCompanyCharges(
    companyId: string,
    actor: SyncActor = SYSTEM_ACTOR,
  ): Promise<ChargeSyncCounts> {
    const total: ChargeSyncCounts = { created: 0, updated: 0, canceled: 0 };

    for (const sub of await this.syncableSubscriptionsOf(companyId)) {
      const listed = await this.asaasGateway.getChargesOf(sub);
      const counts = await this.syncMissingPayments(
        sub.id,
        sub.asaasSubscriptionId,
        listed,
        actor,
      );
      total.created += counts.created;
      total.updated += counts.updated;
      total.canceled += counts.canceled;
    }

    return total;
  }

  /**
   * Alinha as cobranças locais da assinatura ao Asaas: cria as que faltam,
   * atualiza status e links, e baixa as que foram removidas lá.
   */
  private async syncMissingPayments(
    localSubscriptionId: string,
    asaasSubscriptionId: string,
    asaasPayments: any[],
    actor: SyncActor = SYSTEM_ACTOR,
  ): Promise<ChargeSyncCounts> {
    const plan = await this.planChargeSync(localSubscriptionId, asaasPayments);
    return this.applyChargeSyncPlan(localSubscriptionId, plan, actor);
  }

  /**
   * O que a sincronização faria com as cobranças da assinatura. Só lê.
   *
   * As cobranças locais em aberto que a listagem do Asaas não trouxe são
   * consultadas uma a uma. "Não veio na listagem" não basta para baixar nada:
   * a listagem da assinatura também não traz cobranças avulsas (a primeira de
   * uma contratação, a de uma evolução). Só a resposta do Asaas sobre aquela
   * cobrança decide — e só a removida ou inexistente é baixada.
   */
  private async planChargeSync(
    localSubscriptionId: string,
    asaasPayments: any[],
  ): Promise<ChargeSyncPlan> {
    const plan: ChargeSyncPlan = { create: [], update: [], cancel: [] };

    for (const asaasPayment of asaasPayments) {
      const exists = await this.prisma.payment.findFirst({
        where: { asaasPaymentId: asaasPayment.id },
      });
      if (!exists) {
        plan.create.push(asaasPayment);
        continue;
      }
      const status = this.mapAsaasStatus(asaasPayment.status);
      if (
        exists.status !== status ||
        (!exists.invoiceUrl && asaasPayment.invoiceUrl) ||
        (!exists.bankSlipUrl && asaasPayment.bankSlipUrl)
      ) {
        plan.update.push({ local: exists, remote: asaasPayment, status });
      }
    }

    const listed = new Set(asaasPayments.map((p) => p.id));
    const open = await this.prisma.payment.findMany({
      where: {
        subscriptionId: localSubscriptionId,
        status: { in: ['PENDING', 'OVERDUE'] },
        asaasPaymentId: { startsWith: 'pay_' },
      },
    });
    for (const local of open) {
      if (listed.has(local.asaasPaymentId)) continue;
      try {
        const remote = await this.asaasGateway.getAsaasPayment(
          local.asaasPaymentId,
        );
        if (!remote || remote.deleted === true) {
          plan.cancel.push({ local, remote });
        }
      } catch (error) {
        this.logger.warn(
          `Cobrança ${local.asaasPaymentId} não conferida no Asaas: ${error.message}`,
        );
      }
    }

    return plan;
  }

  private async applyChargeSyncPlan(
    localSubscriptionId: string,
    plan: ChargeSyncPlan,
    actor: SyncActor,
  ): Promise<ChargeSyncCounts> {
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

    for (const { local, remote, status } of plan.update) {
      await this.prisma.payment.update({
        where: { id: local.id },
        data: {
          status,
          confirmedDate: remote.confirmedDate
            ? new Date(remote.confirmedDate)
            : local.confirmedDate,
          paymentDate: remote.paymentDate
            ? new Date(remote.paymentDate)
            : local.paymentDate,
          invoiceUrl: remote.invoiceUrl || local.invoiceUrl,
          bankSlipUrl: remote.bankSlipUrl || local.bankSlipUrl,
        },
      });
      this.logger.log(
        `Payment ${local.id} atualizado: status=${status}, invoiceUrl=${remote.invoiceUrl ? 'YES' : 'kept'}`,
      );
    }

    for (const asaasPayment of plan.create) {
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

    for (const { local, remote } of plan.cancel) {
      await this.cancelRemovedCharge(local, remote, actor);
    }

    return {
      created: plan.create.length,
      updated: plan.update.length,
      canceled: plan.cancel.length,
    };
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
