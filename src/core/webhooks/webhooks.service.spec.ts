import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { SubscriptionBlockService } from '../subscriptions/subscription-block.service';
import { AsaasGatewayService } from '../subscriptions/asaas-gateway.service';
import { AsaasWebhookEvent } from './dto/asaas-webhook.dto';

describe('WebhooksService', () => {
  let service: WebhooksService;

  const mockPrismaService = {
    webhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    subscription: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    subscriptionHistory: {
      create: jest.fn(),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    coupon: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    plan: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    subscriptionFeature: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Executa o callback com o próprio mock: a ativação acontece dentro de uma
    // transação, e sem isto as escritas ficariam invisíveis para os testes.
    $transaction: jest.fn((arg: any) =>
      typeof arg === 'function' ? arg(mockPrismaService) : Promise.all(arg),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: SubscriptionBlockService,
          useValue: {
            checkAndApplyBlocks: jest.fn(),
            unblockCompany: jest.fn(),
          },
        },
        {
          provide: AsaasGatewayService,
          useValue: {
            updateAsaasSubscription: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleAsaasWebhook', () => {
    it('should save event and process it', async () => {
      const payload = {
        event: AsaasWebhookEvent.PAYMENT_CONFIRMED,
        payment: { id: 'pay_123', subscription: 'sub_123' },
      };

      mockPrismaService.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrismaService.webhookEvent.create.mockResolvedValue({
        id: 'evt-1',
      });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});
      mockPrismaService.payment.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      const result = await service.handleAsaasWebhook(payload as any);

      expect(result.received).toBe(true);
      expect(result.eventId).toBe('evt-1');
      expect(mockPrismaService.webhookEvent.create).toHaveBeenCalled();
    });

    it('should return existing event for duplicate (idempotent)', async () => {
      const payload = {
        event: AsaasWebhookEvent.PAYMENT_CONFIRMED,
        payment: { id: 'pay_dup' },
      };

      mockPrismaService.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-existing',
      });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});
      mockPrismaService.payment.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      const result = await service.handleAsaasWebhook(payload as any);

      expect(result.eventId).toBe('evt-existing');
      expect(mockPrismaService.webhookEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentConfirmed (via handleAsaasWebhook)', () => {
    const makePayload = (paymentId: string, subscriptionId?: string) => ({
      event: AsaasWebhookEvent.PAYMENT_CONFIRMED,
      payment: {
        id: paymentId,
        subscription: subscriptionId,
        paymentDate: '2026-01-15',
      },
    });

    beforeEach(() => {
      mockPrismaService.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrismaService.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});
    });

    it('should update payment status to CONFIRMED', async () => {
      mockPrismaService.payment.findFirst.mockResolvedValue({
        id: 'local-pay-1',
        subscriptionId: 'sub-local-1',
        value: 14700,
        billingType: 'CREDIT_CARD',
        subscription: { id: 'sub-local-1' },
      });
      mockPrismaService.payment.update.mockResolvedValue({});
      mockPrismaService.subscriptionHistory.create.mockResolvedValue({});
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      await service.handleAsaasWebhook(makePayload('pay_123') as any);

      expect(mockPrismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'local-pay-1' },
          data: expect.objectContaining({ status: 'CONFIRMED' }),
        }),
      );
    });

    it('should activate subscription on payment confirmation', async () => {
      mockPrismaService.payment.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-local-1',
        companyId: 'company-1',
        status: 'INACTIVE',
      });
      mockPrismaService.subscription.update.mockResolvedValue({});
      mockPrismaService.subscriptionHistory.create.mockResolvedValue({});

      await service.handleAsaasWebhook(
        makePayload('pay_123', 'sub_asaas_1') as any,
      );

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      );
    });
  });

  describe('handlePaymentOverdue (via handleAsaasWebhook)', () => {
    it('should update payment status to OVERDUE', async () => {
      mockPrismaService.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrismaService.webhookEvent.create.mockResolvedValue({ id: 'evt-2' });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});
      mockPrismaService.payment.findFirst.mockResolvedValue({
        id: 'local-pay-2',
        subscriptionId: 'sub-2',
        value: 14700,
        dueDate: new Date(),
        subscription: {},
      });
      mockPrismaService.payment.update.mockResolvedValue({});
      mockPrismaService.subscriptionHistory.create.mockResolvedValue({});
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      await service.handleAsaasWebhook({
        event: AsaasWebhookEvent.PAYMENT_OVERDUE,
        payment: { id: 'pay_overdue' },
      } as any);

      expect(mockPrismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'OVERDUE' }),
        }),
      );
    });
  });

  describe('handleSubscriptionExpired (via handleAsaasWebhook)', () => {
    it('should mark subscription as EXPIRED', async () => {
      mockPrismaService.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrismaService.webhookEvent.create.mockResolvedValue({ id: 'evt-3' });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});
      mockPrismaService.payment.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-local-3',
        status: 'ACTIVE',
      });
      mockPrismaService.subscription.update.mockResolvedValue({});

      await service.handleAsaasWebhook({
        event: AsaasWebhookEvent.SUBSCRIPTION_EXPIRED,
        subscription: { id: 'sub_expired' },
      } as any);

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'EXPIRED' },
        }),
      );
    });
  });

  describe('handleSubscriptionDeleted (via handleAsaasWebhook)', () => {
    it('should mark subscription as CANCELED', async () => {
      mockPrismaService.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrismaService.webhookEvent.create.mockResolvedValue({ id: 'evt-4' });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});
      mockPrismaService.payment.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-local-4',
        status: 'ACTIVE',
      });
      mockPrismaService.subscription.update.mockResolvedValue({});

      await service.handleAsaasWebhook({
        event: AsaasWebhookEvent.SUBSCRIPTION_DELETED,
        subscription: { id: 'sub_deleted' },
      } as any);

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'CANCELED' },
        }),
      );
    });

    it('assinatura já encerrada aqui (evoluída) não ganha histórico de cancelamento', async () => {
      mockPrismaService.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrismaService.webhookEvent.create.mockResolvedValue({ id: 'evt-4b' });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-local-evoluida',
        status: 'CANCELED',
        endedReason: 'EVOLVED',
      });

      await service.handleAsaasWebhook({
        event: AsaasWebhookEvent.SUBSCRIPTION_DELETED,
        subscription: { id: 'sub_old' },
      } as any);

      expect(mockPrismaService.subscription.update).not.toHaveBeenCalled();
      expect(
        mockPrismaService.subscriptionHistory.create,
      ).not.toHaveBeenCalled();
    });
  });

  describe('handleSubscriptionUpdated (via handleAsaasWebhook)', () => {
    it('should update subscription fields from webhook data', async () => {
      mockPrismaService.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrismaService.webhookEvent.create.mockResolvedValue({ id: 'evt-5' });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});
      mockPrismaService.payment.findFirst.mockResolvedValue(null);
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-local-5',
        status: 'ACTIVE',
      });
      mockPrismaService.subscription.update.mockResolvedValue({});

      await service.handleAsaasWebhook({
        event: AsaasWebhookEvent.SUBSCRIPTION_UPDATED,
        subscription: {
          id: 'sub_updated',
          value: 29700,
          cycle: 'MONTHLY',
        },
      } as any);

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            value: 29700,
            cycle: 'MONTHLY',
          }),
        }),
      );
    });
  });

  describe('unhandled events', () => {
    it('should process without errors for unknown event type', async () => {
      mockPrismaService.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrismaService.webhookEvent.create.mockResolvedValue({ id: 'evt-6' });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});

      const result = await service.handleAsaasWebhook({
        event: 'PAYMENT_BANK_SLIP_VIEWED',
        payment: { id: 'pay_unknown' },
      } as any);

      expect(result.received).toBe(true);
      expect(mockPrismaService.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { processed: true },
        }),
      );
    });
  });

  describe('getUnprocessedEvents', () => {
    it('should query unprocessed events ordered by creation', async () => {
      mockPrismaService.webhookEvent.findMany.mockResolvedValue([]);

      await service.getUnprocessedEvents();

      expect(mockPrismaService.webhookEvent.findMany).toHaveBeenCalledWith({
        where: { processed: false },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
    });
  });

  // Regressões da correção de base da cobrança.
  describe('regressões do webhook do Asaas', () => {
    beforeEach(() => {
      mockPrismaService.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrismaService.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrismaService.webhookEvent.update.mockResolvedValue({});
      mockPrismaService.payment.findFirst.mockResolvedValue(null);
    });

    it('converte a data sem hora do Asaas e avança um ciclo', async () => {
      // O Asaas manda "AAAA-MM-DD"; gravar essa string num campo DateTime fazia
      // o Prisma lançar DEPOIS de o trial já ter sido inativado.
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-local-1',
        companyId: 'company-1',
        status: 'INACTIVE',
        cycle: 'MONTHLY',
        nextDueDate: new Date('2026-01-15T00:00:00.000Z'),
      });
      mockPrismaService.subscription.update.mockResolvedValue({});
      mockPrismaService.subscriptionHistory.create.mockResolvedValue({});

      await service.handleAsaasWebhook({
        event: AsaasWebhookEvent.PAYMENT_CONFIRMED,
        payment: {
          id: 'pay_1',
          subscription: 'sub_asaas_1',
          dueDate: '2026-01-15',
        },
      } as any);

      const call = mockPrismaService.subscription.update.mock.calls.find(
        ([arg]: any[]) => arg?.data?.status === 'ACTIVE',
      );
      expect(call).toBeDefined();
      const { nextDueDate } = call[0].data;
      expect(nextDueDate).toBeInstanceOf(Date);
      expect(nextDueDate.toISOString()).toBe('2026-02-15T00:00:00.000Z');
    });

    it('não reprocessa um evento já processado', async () => {
      // O Asaas reenvia o mesmo evento quando não recebe 200; reaplicar a
      // ativação a cada reenvio é o que torna o webhook perigoso.
      mockPrismaService.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt-existente',
        asaasEventId: 'evt_abc',
        processed: true,
      });

      const result = await service.handleAsaasWebhook({
        id: 'evt_abc',
        event: AsaasWebhookEvent.PAYMENT_CONFIRMED,
        payment: { id: 'pay_1', subscription: 'sub_asaas_1' },
      } as any);

      expect(result.duplicate).toBe(true);
      expect(mockPrismaService.subscription.update).not.toHaveBeenCalled();
      expect(mockPrismaService.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('usa o id do evento como chave de idempotência', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      await service.handleAsaasWebhook({
        id: 'evt_abc',
        event: AsaasWebhookEvent.PAYMENT_CONFIRMED,
        payment: { id: 'pay_1' },
      } as any);

      expect(mockPrismaService.webhookEvent.findUnique).toHaveBeenCalledWith({
        where: { asaasEventId: 'evt_abc' },
      });
    });

    it('não copia o status da assinatura vindo do Asaas', async () => {
      // No Asaas "ACTIVE" quer dizer "assinatura viva", não "paga": copiar isso
      // ativaria uma contratação que ninguém pagou.
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-local-1',
        status: 'INACTIVE',
      });
      mockPrismaService.subscription.update.mockResolvedValue({});

      await service.handleAsaasWebhook({
        id: 'evt_sub',
        event: AsaasWebhookEvent.SUBSCRIPTION_UPDATED,
        subscription: {
          id: 'sub_asaas_1',
          status: 'ACTIVE',
          value: 147,
          nextDueDate: '2026-03-10',
        },
      } as any);

      const [arg] = mockPrismaService.subscription.update.mock.calls[0];
      expect(arg.data.status).toBeUndefined();
      expect(arg.data.value).toBe(147);
      expect(arg.data.nextDueDate).toBeInstanceOf(Date);
    });

    it('não reativa assinatura cancelada', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-local-1',
        companyId: 'company-1',
        status: 'CANCELED',
        cycle: 'MONTHLY',
      });
      mockPrismaService.subscription.update.mockResolvedValue({});

      await service.handleAsaasWebhook({
        id: 'evt_atrasado',
        event: AsaasWebhookEvent.PAYMENT_CONFIRMED,
        payment: {
          id: 'pay_antigo',
          subscription: 'sub_asaas_1',
          dueDate: '2026-01-15',
        },
      } as any);

      expect(mockPrismaService.subscription.update).not.toHaveBeenCalled();
    });

    it('responde sem erro quando o processamento falha', async () => {
      // Erro repetido faz o Asaas interromper a fila da conta inteira; o evento
      // fica com processed=false e é reprocessável pelo endpoint de admin.
      mockPrismaService.subscription.findFirst.mockRejectedValue(
        new Error('banco fora do ar'),
      );

      const result = await service.handleAsaasWebhook({
        id: 'evt_falha',
        event: AsaasWebhookEvent.PAYMENT_CONFIRMED,
        payment: { id: 'pay_1', subscription: 'sub_asaas_1' },
      } as any);

      expect(result.received).toBe(true);
      expect(result.processed).toBe(false);
      // A falha fica registrada no evento, sem marcá-lo como processado.
      expect(mockPrismaService.webhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { attempts: { increment: 1 }, lastError: 'banco fora do ar' },
      });
      expect(mockPrismaService.webhookEvent.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { processed: true } }),
      );
    });

    it('tenta de novo só eventos recentes com poucas tentativas', async () => {
      mockPrismaService.webhookEvent.findMany.mockResolvedValue([]);

      await service.retryFailedEvents();

      const [{ where, take }] =
        mockPrismaService.webhookEvent.findMany.mock.calls[0];
      expect(where.processed).toBe(false);
      expect(where.attempts).toEqual({ gt: 0, lt: 5 });
      expect(where.createdAt.gte).toBeInstanceOf(Date);
      expect(take).toBe(50);
    });

    it('grava o recurso do evento para diagnóstico', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      await service.handleAsaasWebhook({
        id: 'evt_rec',
        event: AsaasWebhookEvent.PAYMENT_CONFIRMED,
        payment: { id: 'pay_9' },
      } as any);

      expect(mockPrismaService.webhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ resourceId: 'pay_9' }),
      });
    });
  });
});
