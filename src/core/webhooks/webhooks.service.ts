import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/config/prisma/prisma.service';
import {
  AsaasWebhookPayload,
  AsaasWebhookEvent,
} from './dto/asaas-webhook.dto';
import { SubscriptionBlockService } from '../subscriptions/subscription-block.service';
import { AsaasGatewayService } from '../subscriptions/asaas-gateway.service';
import { CouponExpiryService } from '../subscriptions/coupon-expiry.service';
import { isInstallmentBilling } from '../subscriptions/billing-mode';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  private static readonly MAX_ATTEMPTS = 5;
  private static readonly RETRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => SubscriptionBlockService))
    private readonly subscriptionBlockService: SubscriptionBlockService,
    private readonly asaasGateway: AsaasGatewayService,
    private readonly couponExpiry: CouponExpiryService,
  ) {}

  async handleAsaasWebhook(payload: AsaasWebhookPayload) {
    this.logger.log(`Recebido webhook: ${payload?.event}`);

    if (!payload?.event) {
      this.logger.warn('Webhook sem evento no corpo; ignorado');
      return { received: true, ignored: true };
    }

    const { event: webhookEvent, alreadyProcessed } =
      await this.saveWebhookEvent(payload);

    // Entrega repetida do mesmo evento não reprocessa: o Asaas reenvia quando
    // não recebe 200, e reaplicar ativação/cancelamento a cada reenvio é o que
    // torna o webhook perigoso.
    if (alreadyProcessed) {
      this.logger.warn(
        `Evento ${webhookEvent.asaasEventId} já processado; ignorado`,
      );
      return { received: true, duplicate: true, eventId: webhookEvent.id };
    }

    try {
      await this.processWebhookEvent(webhookEvent.id, payload);
      return { received: true, eventId: webhookEvent.id };
    } catch (error) {
      // Responder 200 mesmo em falha é deliberado: erro repetido faz o Asaas
      // interromper a fila da conta inteira. O evento fica com processed=false
      // e é reprocessável por POST /webhooks/events/:id/reprocess.
      this.logger.error(
        `Erro ao processar webhook ${webhookEvent.id}: ${error.message}`,
        error,
      );
      await this.recordFailure(webhookEvent.id, error);
      return { received: true, processed: false, eventId: webhookEvent.id };
    }
  }

  private async saveWebhookEvent(payload: AsaasWebhookPayload) {
    // A chave é o id do EVENTO. Usar o id do pagamento juntava eventos
    // diferentes da mesma cobrança (criada, confirmada, vencida) num registro só.
    const asaasEventId =
      payload.id ||
      [
        payload.event,
        payload.payment?.id || payload.subscription?.id || 'sem-recurso',
        payload.dateCreated || '',
      ].join(':');

    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { asaasEventId },
    });

    if (existingEvent) {
      return {
        event: existingEvent,
        alreadyProcessed: existingEvent.processed,
      };
    }

    const created = await this.prisma.webhookEvent.create({
      data: {
        asaasEventId,
        eventType: payload.event,
        payload: payload as any,
        processed: false,
        resourceId:
          payload.payment?.id ||
          payload.subscription?.id ||
          payload.data?.id ||
          null,
      },
    });

    return { event: created, alreadyProcessed: false };
  }

  private async processWebhookEvent(
    eventId: string,
    payload: AsaasWebhookPayload,
  ) {
    try {
      switch (payload.event) {
        case AsaasWebhookEvent.PAYMENT_CONFIRMED:
        case AsaasWebhookEvent.PAYMENT_RECEIVED:
        case AsaasWebhookEvent.PAYMENT_RECEIVED_IN_CASH:
          await this.handlePaymentConfirmed(payload);
          break;

        case AsaasWebhookEvent.PAYMENT_CREATED:
          await this.handlePaymentCreated(payload);
          break;

        case AsaasWebhookEvent.PAYMENT_OVERDUE:
          await this.handlePaymentOverdue(payload);
          break;

        case AsaasWebhookEvent.PAYMENT_DELETED:
        case AsaasWebhookEvent.PAYMENT_RESTORED:
        case AsaasWebhookEvent.PAYMENT_REFUNDED:
          await this.handlePaymentChangedAtGateway(payload);
          break;

        case AsaasWebhookEvent.SUBSCRIPTION_EXPIRED:
          await this.handleSubscriptionExpired(payload);
          break;

        case AsaasWebhookEvent.SUBSCRIPTION_UPDATED:
          await this.handleSubscriptionUpdated(payload);
          break;

        case AsaasWebhookEvent.SUBSCRIPTION_DELETED:
          await this.handleSubscriptionDeleted(payload);
          break;

        default:
          this.logger.log(`Evento ${payload.event} não tem handler específico`);
      }

      // Marcar evento como processado
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { processed: true },
      });

      this.logger.log(`Evento ${eventId} processado com sucesso`);
    } catch (error) {
      this.logger.error(
        `Erro ao processar evento ${eventId}: ${error.message}`,
        error,
      );
      throw error;
    }
  }
  /**
   * Cobrança removida, restaurada ou estornada no Asaas. Nada é decidido pelo
   * payload: a cobrança é consultada no Asaas e o registro local passa a
   * refletir o que ele diz — o endpoint aceita qualquer chamada enquanto o
   * token do webhook não estiver definido. Na remoção, só uma cobrança que o
   * Asaas confirma como removida é baixada.
   *
   * Asaas indisponível: o erro sobe e o evento volta na fila de retentativa.
   */
  private async handlePaymentChangedAtGateway(payload: AsaasWebhookPayload) {
    const asaasPaymentId = (payload.payment || payload.data)?.id;
    if (!asaasPaymentId) {
      this.logger.warn(`${payload.event} sem id de cobrança; ignorado`);
      return;
    }

    const result = await this.subscriptionBlockService.refreshLocalCharge(
      asaasPaymentId,
      { onlyIfRemoved: payload.event === AsaasWebhookEvent.PAYMENT_DELETED },
    );
    this.logger.log(`${payload.event} ${asaasPaymentId}: ${result}`);
  }

  /**
   * Handles PAYMENT_CREATED webhook — creates new payment record for monthly renewals
   */
  private async handlePaymentCreated(payload: AsaasWebhookPayload) {
    const paymentData = payload.payment || payload.data;
    const asaasPaymentId = paymentData?.id;
    const subscriptionAsaasId = paymentData?.subscription;

    this.logger.log(`Payment criado no Asaas: ${asaasPaymentId}`);

    if (!asaasPaymentId || !subscriptionAsaasId) {
      this.logger.warn('PAYMENT_CREATED sem paymentId ou subscriptionId');
      return;
    }

    // Verificar se já existe
    const existing = await this.prisma.payment.findFirst({
      where: { asaasPaymentId },
    });
    if (existing) {
      // Atualizar invoiceUrl se faltava
      if (!existing.invoiceUrl && paymentData.invoiceUrl) {
        await this.prisma.payment.update({
          where: { id: existing.id },
          data: {
            invoiceUrl: paymentData.invoiceUrl,
            bankSlipUrl: paymentData.bankSlipUrl || existing.bankSlipUrl,
          },
        });
        this.logger.log(`Payment ${existing.id} atualizado com invoiceUrl`);
      }
      return;
    }

    // Buscar subscription local
    const subscription = await this.prisma.subscription.findFirst({
      where: { asaasSubscriptionId: subscriptionAsaasId },
    });

    if (!subscription) {
      this.logger.warn(
        `Subscription ${subscriptionAsaasId} não encontrada localmente para PAYMENT_CREATED`,
      );
      return;
    }

    // Criar payment
    await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        asaasPaymentId: paymentData.id,
        asaasCustomerId: paymentData.customer,
        value: paymentData.value,
        dueDate: new Date(paymentData.dueDate),
        billingType: paymentData.billingType || 'PIX',
        status: 'PENDING',
        description: paymentData.description || 'Assinatura',
        invoiceUrl: paymentData.invoiceUrl,
        bankSlipUrl: paymentData.bankSlipUrl,
      },
    });

    this.logger.log(
      `Payment ${asaasPaymentId} criado localmente via webhook PAYMENT_CREATED`,
    );
  }

  /**
   * O Asaas entrega datas como "AAAA-MM-DD". O Prisma recusa esse formato num
   * campo DateTime, então toda data vinda do webhook passa por aqui.
   */
  private parseAsaasDate(value?: string | null): Date | null {
    if (!value) return null;
    const raw = String(value).trim();
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const parsed = new Date(isDateOnly ? `${raw}T00:00:00.000Z` : raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** Avança uma data em um ciclo de cobrança. Ciclo desconhecido devolve null. */
  private addCycle(date: Date | null, cycle?: string | null): Date | null {
    if (!date || !cycle) return null;
    const next = new Date(date);
    switch (cycle) {
      case 'WEEKLY':
        next.setDate(next.getDate() + 7);
        return next;
      case 'BIWEEKLY':
        next.setDate(next.getDate() + 14);
        return next;
      case 'MONTHLY':
        next.setMonth(next.getMonth() + 1);
        return next;
      case 'BIMONTHLY':
        next.setMonth(next.getMonth() + 2);
        return next;
      case 'QUARTERLY':
        next.setMonth(next.getMonth() + 3);
        return next;
      case 'SEMIANNUALLY':
        next.setMonth(next.getMonth() + 6);
        return next;
      case 'YEARLY':
        next.setFullYear(next.getFullYear() + 1);
        return next;
      default:
        return null;
    }
  }

  private async handlePaymentConfirmed(payload: AsaasWebhookPayload) {
    this.logger.log(
      `Pagamento confirmado: ${payload.payment?.id || payload.data?.id}`,
    );

    const asaasPaymentId = payload.payment?.id || payload.data?.id;
    const subscriptionId =
      payload.payment?.subscription || payload.data?.subscription;

    // Atualizar Payment local
    const payment = await this.prisma.payment.findFirst({
      where: { asaasPaymentId },
      include: { subscription: true },
    });

    if (payment) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'CONFIRMED',
          confirmedDate: new Date(),
          paymentDate: payload.payment?.paymentDate
            ? new Date(payload.payment.paymentDate)
            : new Date(),
          invoiceUrl:
            payload.payment?.invoiceUrl ||
            payload.data?.invoiceUrl ||
            payment.invoiceUrl,
          bankSlipUrl:
            payload.payment?.bankSlipUrl ||
            payload.data?.bankSlipUrl ||
            payment.bankSlipUrl,
        },
      });

      this.logger.log(`Payment ${payment.id} atualizado para CONFIRMED`);

      // Registrar no histórico da subscription
      if (payment.subscriptionId) {
        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: payment.subscriptionId,
            action: 'PAYMENT_CONFIRMED',
            description: 'Pagamento confirmado',
            metadata: {
              paymentId: asaasPaymentId,
              value: payment.value,
              billingType: payment.billingType,
              confirmedDate: new Date(),
            },
            createdByName: 'Sistema Asaas',
          },
        });
      }
    }

    if (subscriptionId || payment?.subscription?.asaasSubscriptionId) {
      // Fallback: se o payload não trouxer subscriptionId, usar do payment local
      const effectiveSubscriptionId =
        subscriptionId || payment?.subscription?.asaasSubscriptionId;

      // Atualizar status da subscription
      const subscription = await this.prisma.subscription.findFirst({
        where: { asaasSubscriptionId: effectiveSubscriptionId },
      });

      // Assinatura cancelada ou expirada não ressuscita por webhook: uma
      // entrega atrasada (ou o reenvio de uma fila acumulada) de um pagamento
      // antigo reabriria um contrato que já foi encerrado.
      if (
        subscription &&
        (subscription.status === 'CANCELED' ||
          subscription.status === 'EXPIRED')
      ) {
        this.logger.warn(
          `Assinatura ${subscription.id} está ${subscription.status}; o pagamento ${asaasPaymentId} não a reativa`,
        );
        return;
      }

      // Contratação ou evolução que espera o pagamento (regra de 20/10): quem
      // libera é a mesma conferência do alinhamento com o Asaas — na
      // evolução, ela também encerra o plano anterior, que a ativação abaixo
      // deixaria cobrando.
      if (subscription?.status === 'INACTIVE') {
        const contract =
          await this.subscriptionBlockService.activateIfContractPaid(
            subscription.id,
            { id: null, name: 'Sistema Asaas' },
          );
        if (contract !== 'not_applicable') return;
      }

      // Desativada à mão pelo superadmin também não volta por pagamento: foi
      // decisão de quem administra — por exemplo, a cobrança mantida no Asaas
      // para um plano que o cliente usa fora do sistema. O pagamento acima
      // fica registrado.
      if (subscription?.status === 'INACTIVE') {
        const lastStatusChange =
          await this.prisma.subscriptionHistory.findFirst({
            where: { subscriptionId: subscription.id, action: 'STATUS_CHANGE' },
            orderBy: { createdAt: 'desc' },
            select: { metadata: true },
          });
        const newStatus = (lastStatusChange?.metadata as any)?.newStatus;
        if (newStatus === 'INACTIVE') {
          this.logger.warn(
            `Assinatura ${subscription.id} foi desativada manualmente; o pagamento ${asaasPaymentId} não a reativa`,
          );
          return;
        }
      }

      if (subscription) {
        const previousStatus = subscription.status;

        // Buscar subscription TRIAL da mesma empresa, se existir
        const trialSubscription = await this.prisma.subscription.findFirst({
          where: {
            companyId: subscription.companyId,
            status: 'ACTIVE',
            plan: {
              planType: 'TRIAL',
            },
          },
        });

        // O Asaas manda a data como "AAAA-MM-DD", sem hora, e o Prisma recusa
        // esse formato num campo DateTime. A próxima cobrança fica um ciclo à
        // frente da que acabou de ser paga; sem ciclo conhecido, preserva a atual.
        const paidDueDate = this.parseAsaasDate(
          payload.payment?.dueDate || payload.data?.dueDate,
        );
        // No anual parcelado, a parcela paga não diz quando vem a próxima
        // cobrança: ela é a renovação, que já está na assinatura.
        const nextDueDate = isInstallmentBilling(subscription)
          ? subscription.nextDueDate
          : (this.addCycle(paidDueDate, subscription.cycle) ??
            subscription.nextDueDate);

        // Desativar o trial e ativar a paga são um ato só: quando isso rodava
        // solto, uma falha no meio deixava a empresa sem nenhuma assinatura ativa.
        await this.prisma.$transaction(async (tx) => {
          if (trialSubscription) {
            await tx.subscription.update({
              where: { id: trialSubscription.id },
              data: { status: 'INACTIVE' },
            });

            await tx.subscriptionHistory.create({
              data: {
                subscriptionId: trialSubscription.id,
                action: 'DEACTIVATED',
                description: 'Trial desativado após ativação de plano pago',
                changes: {
                  before: { status: 'ACTIVE' },
                  after: { status: 'INACTIVE' },
                },
                metadata: {
                  reason: 'Nova subscription ativada',
                  newSubscriptionId: subscription.id,
                },
                createdByName: 'Sistema Asaas',
              },
            });
          }

          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'ACTIVE',
              nextDueDate,
            },
          });
        });

        if (trialSubscription) {
          this.logger.log(
            `Subscription TRIAL ${trialSubscription.id} desativada automaticamente`,
          );
        }

        this.logger.log(
          `Subscription ${subscription.id} atualizada para ACTIVE`,
        );

        // Fim do desconto das assinaturas antigas: pela data, na rotina de
        // cupons — a mesma que roda todo dia.
        try {
          await this.couponExpiry.expireIfDue(subscription.id);
        } catch (couponError) {
          this.logger.error(
            `Erro ao gerenciar expiração do cupom para a subscription ${subscription.id}: ${couponError.message}`,
          );
        }

        // Registrar ativação no histórico se o status mudou
        if (previousStatus !== 'ACTIVE') {
          await this.prisma.subscriptionHistory.create({
            data: {
              subscriptionId: subscription.id,
              action: 'ACTIVATED',
              description: 'Conta ativada após confirmação de pagamento',
              changes: {
                before: { status: previousStatus },
                after: { status: 'ACTIVE' },
              },
              metadata: {
                reason: 'Pagamento confirmado',
                paymentId: asaasPaymentId,
              },
              createdByName: 'Sistema Asaas',
            },
          });
        }

        // Auto-desbloqueio: se a empresa estava bloqueada, desbloquear
        if (subscription.companyId) {
          const company = await this.prisma.company.findUnique({
            where: { id: subscription.companyId },
            select: { blockLevel: true },
          });

          if (company && company.blockLevel !== 'NONE') {
            await this.subscriptionBlockService.unblockCompany(
              subscription.companyId,
            );
            this.logger.log(
              `Empresa ${subscription.companyId} desbloqueada automaticamente após pagamento confirmado`,
            );

            // Registrar no histórico
            await this.prisma.subscriptionHistory.create({
              data: {
                subscriptionId: subscription.id,
                action: 'COMPANY_UNBLOCKED',
                description: `Empresa desbloqueada automaticamente (era ${company.blockLevel})`,
                metadata: {
                  previousBlockLevel: company.blockLevel,
                  paymentId: asaasPaymentId,
                },
                createdByName: 'Sistema Asaas',
              },
            });
          }
        }
      }
    }
  }

  private async handlePaymentOverdue(payload: AsaasWebhookPayload) {
    this.logger.log(
      `Pagamento em atraso: ${payload.payment?.id || payload.data?.id}`,
    );

    const asaasPaymentId = payload.payment?.id || payload.data?.id;
    const subscriptionId =
      payload.payment?.subscription || payload.data?.subscription;

    // Atualizar Payment local
    const payment = await this.prisma.payment.findFirst({
      where: { asaasPaymentId },
      include: { subscription: true },
    });

    if (payment) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'OVERDUE',
          invoiceUrl:
            payload.payment?.invoiceUrl ||
            payload.data?.invoiceUrl ||
            payment.invoiceUrl,
          bankSlipUrl:
            payload.payment?.bankSlipUrl ||
            payload.data?.bankSlipUrl ||
            payment.bankSlipUrl,
        },
      });

      this.logger.log(`Payment ${payment.id} atualizado para OVERDUE`);

      // Registrar no histórico da subscription
      if (payment.subscriptionId) {
        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: payment.subscriptionId,
            action: 'PAYMENT_OVERDUE',
            description: 'Pagamento em atraso',
            metadata: {
              paymentId: asaasPaymentId,
              value: payment.value,
              dueDate: payment.dueDate,
            },
            createdByName: 'Sistema Asaas',
          },
        });
      }
    }

    if (subscriptionId || payment?.subscription?.asaasSubscriptionId) {
      // Fallback: se o payload não trouxer subscriptionId, usar do payment local
      const effectiveSubscriptionId =
        subscriptionId || payment?.subscription?.asaasSubscriptionId;

      const subscription = await this.prisma.subscription.findFirst({
        where: { asaasSubscriptionId: effectiveSubscriptionId },
      });

      if (subscription && subscription.status === 'ACTIVE') {
        // Não alterar imediatamente para EXPIRED, apenas logar
        this.logger.warn(
          `Subscription ${subscription.id} tem pagamento em atraso`,
        );

        // Aqui você pode implementar lógica de notificação ao cliente
        // await this.notificationService.sendOverdueNotification(subscription);
      }
    }
  }

  private async handleSubscriptionExpired(payload: AsaasWebhookPayload) {
    this.logger.log(
      `Assinatura expirada: ${payload.subscription?.id || payload.data?.id}`,
    );

    const asaasSubscriptionId =
      payload.subscription?.id || payload.data?.id || payload.data?.object?.id;

    if (asaasSubscriptionId) {
      const subscription = await this.prisma.subscription.findFirst({
        where: { asaasSubscriptionId },
      });

      if (subscription) {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'EXPIRED' },
        });

        this.logger.log(`Subscription ${subscription.id} marcada como EXPIRED`);

        // Aqui você pode implementar lógica de notificação ao cliente
        // await this.notificationService.sendExpirationNotification(subscription);
      }
    }
  }

  private async handleSubscriptionUpdated(payload: AsaasWebhookPayload) {
    this.logger.log(
      `Assinatura atualizada: ${payload.subscription?.id || payload.data?.id}`,
    );

    const subscriptionData = payload.subscription || payload.data;
    const asaasSubscriptionId = subscriptionData?.id;

    if (asaasSubscriptionId) {
      const subscription = await this.prisma.subscription.findFirst({
        where: { asaasSubscriptionId },
      });

      if (subscription) {
        const updateData: any = {};

        if (subscriptionData.value) updateData.value = subscriptionData.value;
        if (subscriptionData.nextDueDate) {
          const parsed = this.parseAsaasDate(subscriptionData.nextDueDate);
          if (parsed) updateData.nextDueDate = parsed;
        }
        // O status NÃO é copiado do Asaas: lá "ACTIVE" quer dizer "assinatura
        // viva", não "paga", e uma contratação ainda pendente viraria ativa sem
        // ninguém ter pago. Quem ativa é a confirmação do pagamento.
        if (subscriptionData.cycle) updateData.cycle = subscriptionData.cycle;
        if (subscriptionData.billingType)
          updateData.billingType = subscriptionData.billingType;

        if (Object.keys(updateData).length > 0) {
          await this.prisma.subscription.update({
            where: { id: subscription.id },
            data: updateData,
          });

          this.logger.log(`Subscription ${subscription.id} atualizada`);
        }
      }
    }
  }

  private async handleSubscriptionDeleted(payload: AsaasWebhookPayload) {
    this.logger.log(
      `Assinatura cancelada: ${payload.subscription?.id || payload.data?.id}`,
    );

    const asaasSubscriptionId =
      payload.subscription?.id || payload.data?.id || payload.data?.object?.id;

    if (asaasSubscriptionId) {
      const subscription = await this.prisma.subscription.findFirst({
        where: { asaasSubscriptionId },
      });

      // Já encerrada aqui — pela evolução de plano, pelo cancelamento ou pela
      // contratação desfeita: o aviso do Asaas só confirma o que já foi feito.
      if (subscription?.status === 'CANCELED') {
        this.logger.log(
          `Subscription ${subscription.id} já estava CANCELED; SUBSCRIPTION_DELETED sem efeito`,
        );
        return;
      }

      if (subscription) {
        const previousStatus = subscription.status;

        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'CANCELED' },
        });

        await this.prisma.subscriptionHistory.create({
          data: {
            subscriptionId: subscription.id,
            action: 'CANCELED',
            description:
              'Assinatura cancelada via Asaas (webhook SUBSCRIPTION_DELETED)',
            changes: {
              before: { status: previousStatus },
              after: { status: 'CANCELED' },
            },
            metadata: {
              source: 'asaas_webhook',
              event: 'SUBSCRIPTION_DELETED',
              asaasSubscriptionId,
            },
            createdByName: 'Sistema Asaas',
          },
        });

        this.logger.log(
          `Subscription ${subscription.id} marcada como CANCELED`,
        );
      }
    }
  }

  /**
   * Buscar eventos de webhook não processados
   */
  async getUnprocessedEvents() {
    return this.prisma.webhookEvent.findMany({
      where: { processed: false },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  /**
   * Reprocessar evento
   */
  async reprocessEvent(eventId: string) {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error('Event not found');
    }

    try {
      await this.processWebhookEvent(eventId, event.payload as any);
    } catch (error) {
      await this.recordFailure(eventId, error);
      throw error;
    }
  }

  /** Registra a falha no próprio evento: é o que permite diagnosticar e tentar de novo. */
  private async recordFailure(eventId: string, error: any): Promise<void> {
    try {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          attempts: { increment: 1 },
          lastError: String(error?.message ?? error).slice(0, 2000),
        },
      });
    } catch (recordError) {
      this.logger.error(
        `Não foi possível registrar a falha do evento ${eventId}: ${recordError.message}`,
      );
    }
  }

  /**
   * Nova tentativa automática dos eventos que falharam.
   *
   * O webhook responde 200 mesmo quando o processamento falha, para o Asaas
   * não interromper a fila da conta; sem esta rotina, uma falha momentânea
   * (banco indisponível, Asaas lento) virava um evento perdido até alguém
   * reprocessar à mão.
   *
   * Limites deliberados: poucas tentativas, e só eventos recentes — eventos
   * antigos não são reprocessados (decisão sobre o backlog da fila), e um
   * evento que falha sempre não pode ficar em laço.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'webhook-retry' })
  async retryFailedEvents(): Promise<void> {
    const since = new Date(Date.now() - WebhooksService.RETRY_WINDOW_MS);
    const pending = await this.prisma.webhookEvent.findMany({
      where: {
        processed: false,
        attempts: { gt: 0, lt: WebhooksService.MAX_ATTEMPTS },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    for (const event of pending) {
      try {
        await this.processWebhookEvent(event.id, event.payload as any);
        this.logger.log(`Evento ${event.id} processado na nova tentativa`);
      } catch (error) {
        await this.recordFailure(event.id, error);
      }
    }
  }
}
