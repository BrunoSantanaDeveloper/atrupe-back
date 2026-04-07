import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { SubscriptionBlockService } from '../subscriptions/subscription-block.service';
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
    },
    subscription: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    subscriptionHistory: {
      create: jest.fn(),
    },
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
    it('should mark subscription as INACTIVE', async () => {
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
          data: { status: 'INACTIVE' },
        }),
      );
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
});
