import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasWebhookDto, AsaasWebhookEvent } from './dto/asaas-webhook.dto';
import { SubscriptionBlockService } from '../subscriptions/subscription-block.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => SubscriptionBlockService))
    private readonly subscriptionBlockService: SubscriptionBlockService,
  ) {}

  async handleAsaasWebhook(payload: AsaasWebhookDto) {
    this.logger.log(`Recebido webhook: ${payload.event}`);

    try {
      // Salvar evento no banco de dados
      const webhookEvent = await this.saveWebhookEvent(payload);

      // Processar o evento baseado no tipo
      await this.processWebhookEvent(webhookEvent.id, payload);

      return { received: true, eventId: webhookEvent.id };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook: ${error.message}`, error);
      throw error;
    }
  }

  private async saveWebhookEvent(payload: AsaasWebhookDto) {
    // Gerar um ID único para o evento (usando timestamp + random)
    const asaasEventId =
      payload.payment?.id ||
      payload.subscription?.id ||
      `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Verificar se o evento já foi processado (idempotência)
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { asaasEventId },
    });

    if (existingEvent) {
      this.logger.warn(`Evento ${asaasEventId} já foi processado`);
      return existingEvent;
    }

    return this.prisma.webhookEvent.create({
      data: {
        asaasEventId,
        eventType: payload.event,
        payload: payload as any,
        processed: false,
      },
    });
  }

  private async processWebhookEvent(eventId: string, payload: AsaasWebhookDto) {
    try {
      switch (payload.event) {
        case AsaasWebhookEvent.PAYMENT_CONFIRMED:
        case AsaasWebhookEvent.PAYMENT_RECEIVED:
        case AsaasWebhookEvent.PAYMENT_RECEIVED_IN_CASH:
          await this.handlePaymentConfirmed(payload);
          break;

        case AsaasWebhookEvent.PAYMENT_OVERDUE:
          await this.handlePaymentOverdue(payload);
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

  private async handlePaymentConfirmed(payload: AsaasWebhookDto) {
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

        // Se existe uma subscription TRIAL ativa, desativá-la
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
                reason: 'Nova subscription ativada',
                newSubscriptionId: subscription.id,
              },
              createdByName: 'Sistema Asaas',
            },
          });
        }

        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            nextDueDate:
              payload.payment?.dueDate ||
              payload.data?.dueDate ||
              subscription.nextDueDate,
          },
        });

        this.logger.log(
          `Subscription ${subscription.id} atualizada para ACTIVE`,
        );

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

  private async handlePaymentOverdue(payload: AsaasWebhookDto) {
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

  private async handleSubscriptionExpired(payload: AsaasWebhookDto) {
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

  private async handleSubscriptionUpdated(payload: AsaasWebhookDto) {
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
        if (subscriptionData.nextDueDate)
          updateData.nextDueDate = new Date(subscriptionData.nextDueDate);
        if (subscriptionData.status)
          updateData.status = subscriptionData.status;
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

  private async handleSubscriptionDeleted(payload: AsaasWebhookDto) {
    this.logger.log(
      `Assinatura cancelada: ${payload.subscription?.id || payload.data?.id}`,
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
          data: { status: 'INACTIVE' },
        });

        this.logger.log(
          `Subscription ${subscription.id} marcada como INACTIVE`,
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

    await this.processWebhookEvent(eventId, event.payload as any);
  }
}
