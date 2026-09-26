import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { SubscriptionBlockService } from './subscription-block.service';
import { isInstallmentBilling } from './billing-mode';
import * as argon2 from 'argon2';

const TRIAL_DAYS_DEFAULT = 7;

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private asaasGateway: AsaasGatewayService,
    private subscriptionBlockService: SubscriptionBlockService,
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
              // Depois de uma transferência de titularidade, a cobrança
              // continua no nome de quem a gerou.
              customer: { select: { name: true, document: true } },
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

  /** Formata data no padrão aceito pelo Asaas (YYYY-MM-DD) */
  private toAsaasDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /** Avança a data em um ciclo de cobrança */
  private addCycle(date: Date, cycle?: string): Date {
    const next = new Date(date);

    if (cycle === 'YEARLY') {
      next.setFullYear(next.getFullYear() + 1);
    } else {
      next.setMonth(next.getMonth() + 1);
    }

    return next;
  }

  /**
   * Troca o plano da assinatura atual "in-place", sem cancelar/recriar a
   * assinatura no Asaas.
   *
   * Só o suporte troca de plano por aqui (changePlanAsAdmin). O cliente evolui
   * pela trilha (POST /subscriptions/evolution), com sequência e crédito; a
   * troca livre que a tela de conta suspensa oferecia foi aposentada.
   *
   * Por que in-place: a antiga rota de upgrade (aposentada) cancelava a
   * assinatura no Asaas e criava outra. Se a empresa estava inadimplente, a
   * cobrança vencida ficava órfã da assinatura antiga e o bloqueio deixava de
   * encontrá-la (débito perdido).
   *
   * Política de cobrança quando há inadimplência (conta bloqueada):
   * o cliente paga para usar — e durante o bloqueio ele não teve acesso. Por
   * isso o ciclo é REINICIADO em vez de cobrar o período vencido: a cobrança
   * mais antiga é reemitida com o valor do plano escolhido agora, vencendo
   * hoje, e as demais cobranças em aberto (períodos não usufruídos) são
   * removidas. O próximo vencimento passa a ser um ciclo à frente de hoje.
   *
   * Sem inadimplência, nada disso se aplica: apenas o valor da assinatura muda,
   * valendo a partir do próximo ciclo, sem mexer em cobranças já emitidas.
   */
  async changePlan(
    companyId: string,
    newPlanId: string,
    options?: { skipActiveCheck?: boolean },
  ) {
    // Assinatura real no Asaas (mesmo critério usado pelo fluxo de bloqueio) —
    // a em curso, não uma anterior encerrada por evolução.
    const currentSubscription = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        asaasSubscriptionId: { startsWith: 'sub_' },
        status: { notIn: ['CANCELED', 'EXPIRED'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: true,
        subscriptionFeatures: { include: { feature: true } },
      },
    });

    // O valor abaixo é mensal: aplicado a um anual, cobraria um mês pelo ano.
    // No anual parcelado nem há assinatura no Asaas para alterar.
    const annual =
      currentSubscription?.cycle === 'YEARLY' ||
      (!currentSubscription &&
        !!(await this.prisma.subscription.findFirst({
          where: {
            companyId,
            asaasInstallmentId: { not: null },
            status: { notIn: ['CANCELED', 'EXPIRED'] },
          },
          select: { id: true },
        })));
    if (annual) {
      throw new BadRequestException(
        'A troca de plano no ciclo anual não está disponível por aqui. Fale com a Atrupe.',
      );
    }

    if (!currentSubscription) {
      throw new NotFoundException(
        'Nenhuma assinatura ativa encontrada para esta empresa.',
      );
    }

    const newPlan = await this.prisma.plan.findUnique({
      where: { id: newPlanId },
    });

    if (!newPlan) {
      throw new NotFoundException('Plano não encontrado.');
    }

    if (!options?.skipActiveCheck && !newPlan.isActive) {
      throw new BadRequestException(
        'Este plano não está disponível para contratação.',
      );
    }

    if (!newPlan.basePrice || newPlan.basePrice <= 0) {
      throw new BadRequestException('Este plano não possui preço definido.');
    }

    if (newPlan.id === currentSubscription.planId) {
      throw new BadRequestException('A empresa já está neste plano.');
    }

    // Mantém os módulos adicionais já contratados no novo valor
    const featuresValue = (currentSubscription.subscriptionFeatures || [])
      .filter((sf) => sf.isActive !== false)
      .reduce((sum, sf) => sum + (sf.price || 0), 0);

    const newValue =
      (newPlan.basePrice +
        featuresValue +
        (newPlan.additionalUserPrice || 0) *
          (currentSubscription.additionalUsers || 0)) /
      100;

    // Cobranças em aberto no Asaas (fonte da verdade)
    let openPayments: Array<{ id: string; status: string; dueDate: string }> =
      [];

    try {
      const asaasPayments =
        await this.asaasGateway.getAsaasSubscriptionPayments(
          currentSubscription.asaasSubscriptionId,
        );

      openPayments = asaasPayments
        .filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE')
        .sort(
          (a, b) =>
            new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
        );
    } catch (error) {
      this.logger.warn(
        `Não foi possível listar cobranças da assinatura ${currentSubscription.asaasSubscriptionId}: ${error.message}`,
      );
    }

    const hasOverdue = openPayments.some((p) => p.status === 'OVERDUE');
    const today = new Date();

    if (hasOverdue) {
      // Reset de ciclo: não cobra o período em que a conta esteve bloqueada.
      const nextDueDate = this.addCycle(today, currentSubscription.cycle);

      await this.asaasGateway.updateAsaasSubscription(
        currentSubscription.asaasSubscriptionId,
        {
          value: newValue,
          description: `Assinatura ${newPlan.name}`,
          nextDueDate: this.toAsaasDate(nextDueDate),
          updatePendingPayments: false,
        },
      );

      // Reaproveita a cobrança mais antiga como fatura de reativação.
      // Feito ANTES de remover as demais para o cliente nunca ficar sem
      // nenhuma cobrança pagável — o desbloqueio depende desse pagamento.
      const [invoiceToKeep, ...supersededInvoices] = openPayments;

      await this.asaasGateway.updateAsaasPayment(invoiceToKeep.id, {
        value: newValue,
        dueDate: this.toAsaasDate(today),
        description: `Assinatura ${newPlan.name}`,
      });

      for (const invoice of supersededInvoices) {
        try {
          await this.asaasGateway.deleteAsaasPayment(invoice.id);
        } catch (error) {
          // Não aborta a troca: a fatura de reativação já está correta.
          this.logger.warn(
            `Falha ao remover cobrança ${invoice.id} superada pelo reset de ciclo: ${error.message}`,
          );
        }
      }
    } else {
      // Assinatura em dia: muda apenas o valor daqui pra frente, sem mexer no
      // ciclo nem nas cobranças já emitidas.
      await this.asaasGateway.updateAsaasSubscription(
        currentSubscription.asaasSubscriptionId,
        {
          value: newValue,
          description: `Assinatura ${newPlan.name}`,
          updatePendingPayments: false,
        },
      );
    }

    const updated = await this.prisma.subscription.update({
      where: { id: currentSubscription.id },
      data: {
        planId: newPlan.id,
        value: newValue,
        ...(hasOverdue ? { nextDueDate: today } : {}),
      },
      include: { plan: true },
    });

    this.logger.log(
      `Plano da empresa ${companyId} alterado de ${currentSubscription.plan?.name} para ${newPlan.name}` +
        (hasOverdue
          ? ` (ciclo reiniciado: cobrança de reativação de R$ ${newValue} vencendo hoje)`
          : ' (sem inadimplência: novo valor vale a partir do próximo ciclo)'),
    );

    return updated;
  }

  /**
   * Troca o plano de uma empresa a pedido do SystemAdmin (suporte/comercial).
   * Exige a senha gerencial, seguindo a convenção dos demais mutadores admin.
   * A regra de cobrança é a mesma do cliente: reset de ciclo se houver
   * inadimplência, caso contrário só o valor muda a partir do próximo ciclo.
   */
  async changePlanAsAdmin(
    companyId: string,
    newPlanId: string,
    password: string,
    adminUserId: string,
  ) {
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

    this.logger.log(
      `SystemAdmin ${adminUserId} solicitou troca de plano da empresa ${companyId}`,
    );

    return this.changePlan(companyId, newPlanId, { skipActiveCheck: true });
  }

  /**
   * Se a assinatura tem mensalidade vencida. Quem responde é o Asaas — o banco
   * pode não ter visto uma que venceu —; sem resposta dele, o nosso registro.
   */
  private async hasOverdueCharge(subscription: {
    id: string;
    asaasSubscriptionId: string;
    asaasInstallmentId?: string | null;
  }): Promise<boolean> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = startOfToday.toISOString().slice(0, 10);

    const billedByGateway =
      subscription.asaasSubscriptionId.startsWith('sub_') ||
      !!subscription.asaasInstallmentId;
    if (billedByGateway) {
      try {
        const charges = await this.asaasGateway.getChargesOf(subscription);
        return charges.some(
          (p) =>
            p.status === 'OVERDUE' ||
            (p.status === 'PENDING' && String(p.dueDate) < today),
        );
      } catch (error) {
        this.logger.warn(
          `Cobranças da assinatura ${subscription.id} não consultadas no Asaas; valendo o registro local: ${error.message}`,
        );
      }
    }

    const overdue = await this.prisma.payment.findFirst({
      where: {
        subscriptionId: subscription.id,
        OR: [
          { status: 'OVERDUE' },
          { status: 'PENDING', dueDate: { lt: startOfToday } },
        ],
      },
      select: { id: true },
    });
    return !!overdue;
  }

  async cancelSubscription(
    subscriptionId: string,
    cancelDto: CancelSubscriptionDto,
    companyId: string,
    userId: string,
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

    // Cancelar é poder exclusivo do Administrador Principal da Conta, o
    // Usuário nº 1 (contrato 1.1, 4.2 e 8.1). Conta antiga sem ele registrado
    // segue como antes.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { ownerUserId: true, blockLevel: true },
    });
    if (company?.ownerUserId && company.ownerUserId !== userId) {
      throw new ForbiddenException({
        code: 'OWNER_ONLY',
        message:
          'Somente o administrador principal da conta (Usuário nº 1) pode cancelar a assinatura.',
      });
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

    // O cancelamento corta o acesso na hora. No anual, isso jogaria fora o que
    // resta de um ano já pago — até haver regra para ele, é feito pela Atrupe.
    if (subscription.cycle === 'YEARLY' || isInstallmentBilling(subscription)) {
      throw new BadRequestException(
        'Para cancelar o plano anual, fale com a Atrupe.',
      );
    }

    // Contrato 1.1, 7.5 e 8.1: o cancelamento só é concluído sem mensalidade
    // vencida. Bloqueio não é cancelamento (7.6) — a cobrança continua.
    const blocked = !!company?.blockLevel && company.blockLevel !== 'NONE';
    if (blocked || (await this.hasOverdueCharge(subscription))) {
      throw new ConflictException({
        code: 'OPEN_CHARGE',
        message:
          'Há mensalidade vencida. Regularize a cobrança para cancelar a assinatura.',
      });
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
            // Contrato 1.1, 5.10 e 9.2: a confirmação de que as exportações
            // necessárias foram feitas antes do cancelamento.
            exportsConfirmed: cancelDto.exportsConfirmed ?? null,
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

      const asaasPayments = await this.asaasGateway.getChargesOf(subscription);

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

    // Buscar a subscription mais recente da empresa que não seja TRIAL — e
    // que não seja uma contratação desfeita no meio: uma tentativa de evolução
    // que falhou é mais nova que a assinatura que continua valendo.
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        companyId,
        status: {
          in: ['ACTIVE', 'INACTIVE', 'BLOCKED', 'CANCELED'],
        },
        plan: {
          planType: {
            not: 'TRIAL',
          },
        },
        OR: [{ endedReason: null }, { endedReason: { not: 'ABANDONED' } }],
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

    // Se já está ativa, não precisa reativar — mas ainda pode estar bloqueada.
    // Quem pagou e continuava bloqueado saía daqui com "already_active" e só
    // era desbloqueado pelo cron das 03:00, ficando horas fora do sistema
    // depois de ter pago.
    if (subscription.status === 'ACTIVE') {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { blockLevel: true },
      });

      if (company && company.blockLevel !== 'NONE') {
        const hasOverdue = await this.prisma.payment.findFirst({
          where: {
            subscriptionId: subscription.id,
            status: 'OVERDUE',
          },
        });

        if (!hasOverdue) {
          await this.subscriptionBlockService.unblockCompany(companyId);
          this.logger.log(
            `Empresa ${companyId} desbloqueada: assinatura ativa e sem cobrança vencida`,
          );
          return { status: 'unblocked', subscription };
        }
      }

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
      const asaasPayments = await this.asaasGateway.getChargesOf(subscription);

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
            // No anual parcelado, o vencimento é o da renovação, não o de uma
            // parcela.
            nextDueDate:
              latestPayment.dueDate && !isInstallmentBilling(subscription)
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
