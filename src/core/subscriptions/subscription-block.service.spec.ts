import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SubscriptionBlockService } from './subscription-block.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BlockLevel } from '@prisma/client';

describe('SubscriptionBlockService', () => {
  let service: SubscriptionBlockService;

  const mockPrismaService = {
    company: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    companyHistory: {
      create: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
    },
  };

  const mockAsaasGatewayService = {
    getAsaasSubscriptionPayments: jest.fn(),
    getSubscriptionPayments: jest.fn(),
    getInstallmentPayments: jest.fn(),
    // O serviço pede as cobranças pelo modo; o mock responde como o gateway:
    // parcelas do parcelamento, ou cobranças da assinatura.
    getChargesOf: jest.fn((sub: any) =>
      sub.asaasInstallmentId
        ? mockAsaasGatewayService.getInstallmentPayments(sub.asaasInstallmentId)
        : mockAsaasGatewayService.getAsaasSubscriptionPayments(
            sub.asaasSubscriptionId,
          ),
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionBlockService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AsaasGatewayService,
          useValue: mockAsaasGatewayService,
        },
      ],
    }).compile();

    service = module.get<SubscriptionBlockService>(SubscriptionBlockService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkAndApplyBlocks', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const makeDueDate = (daysAgo: number) => {
      const date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      return date.toISOString().split('T')[0];
    };

    it('should apply PARTIAL block for company with 3+ days overdue in Asaas', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-1',
          name: 'Test Company',
          blockLevel: 'NONE',
          Subscription: [
            { asaasSubscriptionId: 'sub_123', nextDueDate: new Date() },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'OVERDUE', dueDate: makeDueDate(3) },
      ]);
      mockPrismaService.company.update.mockResolvedValue({});

      const results = await service.checkAndApplyBlocks();

      expect(results).toHaveLength(1);
      expect(results[0].newBlockLevel).toBe('PARTIAL');
      expect(results[0].action).toBe('blocked');
      expect(mockPrismaService.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: expect.objectContaining({
          blockLevel: 'PARTIAL',
        }),
      });
    });

    it('anual parcelado: o atraso vem das parcelas, não de uma assinatura do Asaas', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-1',
          name: 'Test Company',
          blockLevel: 'NONE',
          Subscription: [
            {
              asaasSubscriptionId: 'inst_sub-1',
              asaasInstallmentId: 'ins_1',
              billingMode: 'ASAAS_INSTALLMENT',
              nextDueDate: new Date(),
            },
          ],
        },
      ]);
      mockAsaasGatewayService.getInstallmentPayments.mockResolvedValue([
        { status: 'OVERDUE', dueDate: makeDueDate(4) },
      ]);
      mockPrismaService.company.update.mockResolvedValue({});

      const results = await service.checkAndApplyBlocks();

      expect(
        mockAsaasGatewayService.getInstallmentPayments,
      ).toHaveBeenCalledWith('ins_1');
      expect(
        mockAsaasGatewayService.getAsaasSubscriptionPayments,
      ).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({
        newBlockLevel: 'PARTIAL',
        action: 'blocked',
      });
    });

    it('mede o atraso pela cobrança vencida mais antiga', async () => {
      // A listagem do Asaas não vem ordenada. Pegando a primeira vencida, uma
      // empresa com 10 dias de atraso podia ser medida por 1 e escapar do
      // bloqueio: aqui a mais recente vem primeiro de propósito.
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-1',
          name: 'Test Company',
          blockLevel: 'NONE',
          Subscription: [
            { asaasSubscriptionId: 'sub_123', nextDueDate: new Date() },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'OVERDUE', dueDate: makeDueDate(1) },
        { status: 'OVERDUE', dueDate: makeDueDate(10) },
      ]);
      mockPrismaService.company.update.mockResolvedValue({});

      const results = await service.checkAndApplyBlocks();

      expect(results[0].daysOverdue).toBe(10);
      expect(results[0].newBlockLevel).toBe('FULL');
    });

    it('7 dias de atraso ainda é bloqueio parcial (inativa só a partir do 8º)', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-7',
          name: 'Sete dias',
          blockLevel: 'NONE',
          Subscription: [
            { asaasSubscriptionId: 'sub_777', nextDueDate: new Date() },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'OVERDUE', dueDate: makeDueDate(7) },
      ]);
      mockPrismaService.company.update.mockResolvedValue({});

      const results = await service.checkAndApplyBlocks();

      expect(results[0].daysOverdue).toBe(7);
      expect(results[0].newBlockLevel).toBe('PARTIAL');
    });

    it('should apply FULL block for company with 8+ days overdue in Asaas', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-2',
          name: 'Test Company 2',
          blockLevel: 'NONE',
          Subscription: [
            { asaasSubscriptionId: 'sub_456', nextDueDate: new Date() },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'OVERDUE', dueDate: makeDueDate(8) },
      ]);
      mockPrismaService.company.update.mockResolvedValue({});

      const results = await service.checkAndApplyBlocks();

      expect(results).toHaveLength(1);
      expect(results[0].newBlockLevel).toBe('FULL');
      expect(results[0].action).toBe('blocked');
      expect(mockPrismaService.company.update).toHaveBeenCalledWith({
        where: { id: 'company-2' },
        data: expect.objectContaining({
          blockLevel: 'FULL',
          isActive: false,
        }),
      });
    });

    it('should upgrade from PARTIAL to FULL when days increase', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-3',
          name: 'Test Company 3',
          blockLevel: 'PARTIAL',
          Subscription: [
            { asaasSubscriptionId: 'sub_789', nextDueDate: new Date() },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'OVERDUE', dueDate: makeDueDate(10) },
      ]);
      mockPrismaService.company.update.mockResolvedValue({});

      const results = await service.checkAndApplyBlocks();

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('upgraded');
      expect(results[0].newBlockLevel).toBe('FULL');
    });

    it('should NOT downgrade block level automatically', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-4',
          name: 'Test Company 4',
          blockLevel: 'PARTIAL',
          Subscription: [
            { asaasSubscriptionId: 'sub_abc', nextDueDate: new Date() },
          ],
        },
      ]);
      // Only 1 day overdue — would be NONE, but PARTIAL should remain
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'PENDING', dueDate: makeDueDate(1) },
      ]);

      const results = await service.checkAndApplyBlocks();

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('unchanged');
      expect(results[0].newBlockLevel).toBe('PARTIAL');
      expect(mockPrismaService.company.update).not.toHaveBeenCalled();
    });

    it('should not block company when Asaas shows no overdue payments', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-5',
          name: 'Test Company 5',
          blockLevel: 'NONE',
          Subscription: [
            { asaasSubscriptionId: 'sub_def', nextDueDate: new Date() },
          ],
        },
      ]);
      // All payments are confirmed — no overdue
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'CONFIRMED', dueDate: makeDueDate(0) },
        { status: 'RECEIVED', dueDate: makeDueDate(30) },
      ]);

      const results = await service.checkAndApplyBlocks();

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('unchanged');
      expect(results[0].newBlockLevel).toBe('NONE');
      expect(mockPrismaService.company.update).not.toHaveBeenCalled();
    });

    it('should skip manual subscriptions (no asaasSubscriptionId)', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-6',
          name: 'Manual Company',
          blockLevel: 'NONE',
          Subscription: [
            { asaasSubscriptionId: 'manual_123', nextDueDate: new Date() },
          ],
        },
      ]);

      const results = await service.checkAndApplyBlocks();

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(
        mockAsaasGatewayService.getAsaasSubscriptionPayments,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.company.update).not.toHaveBeenCalled();
    });

    it('should skip company when Asaas API fails (not block)', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-7',
          name: 'API Error Company',
          blockLevel: 'NONE',
          Subscription: [
            { asaasSubscriptionId: 'sub_fail', nextDueDate: new Date() },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockRejectedValue(
        new Error('Asaas API timeout'),
      );

      const results = await service.checkAndApplyBlocks();

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(mockPrismaService.company.update).not.toHaveBeenCalled();
    });

    it('should skip company when Asaas returns no payments', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-8',
          name: 'No Payments Company',
          blockLevel: 'NONE',
          Subscription: [
            { asaasSubscriptionId: 'sub_empty', nextDueDate: new Date() },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue(
        [],
      );

      const results = await service.checkAndApplyBlocks();

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('skipped');
      expect(mockPrismaService.company.update).not.toHaveBeenCalled();
    });
  });

  describe('unblockCompany', () => {
    it('should reset blockLevel to NONE', async () => {
      mockPrismaService.company.update.mockResolvedValue({});

      await service.unblockCompany('company-1');

      expect(mockPrismaService.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: {
          blockLevel: 'NONE',
          blockedAt: null,
          blockReason: null,
          isActive: true,
        },
      });
    });
  });

  describe('manualUnblock', () => {
    it('should unblock company and create history entry', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        name: 'Test Company',
        blockLevel: 'FULL',
      });
      mockPrismaService.company.update.mockResolvedValue({});
      mockPrismaService.companyHistory.create.mockResolvedValue({});

      await service.manualUnblock('company-1', 'admin-1');

      expect(mockPrismaService.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: {
          blockLevel: 'NONE',
          blockedAt: null,
          blockReason: null,
          isActive: true,
        },
      });
      expect(mockPrismaService.companyHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          action: 'UNBLOCK',
          createdBy: 'admin-1',
        }),
      });
    });

    it('should throw ForbiddenException if company not found', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue(null);

      await expect(
        service.manualUnblock('invalid-id', 'admin-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getBlockStatus', () => {
    it('should return company block status', async () => {
      const blockedAt = new Date();
      mockPrismaService.company.findUnique.mockResolvedValue({
        blockLevel: 'PARTIAL',
        blockedAt,
        blockReason: '3 dias de atraso',
      });

      const result = await service.getBlockStatus('company-1');

      expect(result).toEqual({
        blockLevel: 'PARTIAL',
        blockedAt,
        blockReason: '3 dias de atraso',
      });
    });

    it('should throw ForbiddenException if company not found', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue(null);

      await expect(service.getBlockStatus('invalid-id')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('listBlockedCompanies', () => {
    it('should return all blocked companies when no filter', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        { id: '1', blockLevel: 'PARTIAL' },
        { id: '2', blockLevel: 'FULL' },
      ]);

      const result = await service.listBlockedCompanies();

      expect(result).toHaveLength(2);
      expect(mockPrismaService.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { blockLevel: { in: ['PARTIAL', 'FULL'] } },
        }),
      );
    });

    it('should filter by specific blockLevel', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        { id: '1', blockLevel: 'FULL' },
      ]);

      const result = await service.listBlockedCompanies('FULL' as BlockLevel);

      expect(result).toHaveLength(1);
      expect(mockPrismaService.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { blockLevel: 'FULL' },
        }),
      );
    });
  });

  describe('getPendingPaymentUrl', () => {
    it('should return invoiceUrl from Asaas API', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        asaasSubscriptionId: 'sub_123',
      });
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        {
          id: 'pay_abc',
          invoiceUrl: 'https://asaas.com/invoice/123',
          bankSlipUrl: null,
          status: 'OVERDUE',
          dueDate: '2024-01-15',
        },
      ]);
      mockPrismaService.payment.findFirst.mockResolvedValue(null);

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBe('https://asaas.com/invoice/123');
      expect(result.dueDate).toEqual(new Date('2024-01-15'));
    });

    it('should cache invoiceUrl to DB when found in Asaas', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        asaasSubscriptionId: 'sub_456',
      });
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        {
          id: 'pay_abc123',
          invoiceUrl: 'https://www.asaas.com/i/live_invoice_url',
          bankSlipUrl: null,
          status: 'OVERDUE',
          dueDate: '2024-01-15',
        },
      ]);
      // Local payment exists but without invoiceUrl
      mockPrismaService.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        asaasPaymentId: 'pay_abc123',
        invoiceUrl: null,
      });
      mockPrismaService.payment.update.mockResolvedValue({});

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBe(
        'https://www.asaas.com/i/live_invoice_url',
      );
      expect(mockPrismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1' },
          data: expect.objectContaining({
            invoiceUrl: 'https://www.asaas.com/i/live_invoice_url',
          }),
        }),
      );
    });

    it('should return null when no subscription found', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBeNull();
      expect(result.dueDate).toBeNull();
    });

    it('should fallback to local cache when Asaas API fails', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        asaasSubscriptionId: 'sub_789',
      });
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockRejectedValue(
        new Error('Asaas timeout'),
      );
      mockPrismaService.payment.findFirst.mockResolvedValue({
        invoiceUrl: 'https://cached.invoiceurl.com',
        dueDate: new Date('2024-02-01'),
      });

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBe('https://cached.invoiceurl.com');
    });

    it('should return null when no invoiceUrl in Asaas and no local cache', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        asaasSubscriptionId: 'sub_noinvoice',
      });
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        {
          id: 'pay_x',
          invoiceUrl: null,
          status: 'OVERDUE',
          dueDate: '2024-01-15',
        },
      ]);
      mockPrismaService.payment.findFirst.mockResolvedValue(null);

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBeNull();
    });
  });
});
