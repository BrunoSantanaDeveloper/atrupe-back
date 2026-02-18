import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SubscriptionBlockService } from './subscription-block.service';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { BlockLevel } from '@prisma/client';

describe('SubscriptionBlockService', () => {
  let service: SubscriptionBlockService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPrismaService = {
    company: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    companyHistory: {
      create: jest.fn(),
    },
  };

  const mockSubscriptionsService = {
    getAsaasSubscriptionPayments: jest.fn(),
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
          provide: SubscriptionsService,
          useValue: mockSubscriptionsService,
        },
      ],
    }).compile();

    service = module.get<SubscriptionBlockService>(SubscriptionBlockService);
    prisma = module.get(PrismaService);

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
      mockSubscriptionsService.getAsaasSubscriptionPayments.mockResolvedValue([
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

    it('should apply FULL block for company with 7+ days overdue in Asaas', async () => {
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
      mockSubscriptionsService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'OVERDUE', dueDate: makeDueDate(7) },
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
      mockSubscriptionsService.getAsaasSubscriptionPayments.mockResolvedValue([
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
      mockSubscriptionsService.getAsaasSubscriptionPayments.mockResolvedValue([
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
      mockSubscriptionsService.getAsaasSubscriptionPayments.mockResolvedValue([
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
        mockSubscriptionsService.getAsaasSubscriptionPayments,
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
      mockSubscriptionsService.getAsaasSubscriptionPayments.mockRejectedValue(
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
      mockSubscriptionsService.getAsaasSubscriptionPayments.mockResolvedValue(
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
    beforeEach(() => {
      (mockPrismaService as any).payment = {
        findFirst: jest.fn(),
      };
    });

    it('should return invoiceUrl when available', async () => {
      (mockPrismaService as any).payment.findFirst.mockResolvedValue({
        invoiceUrl: 'https://asaas.com/invoice/123',
        bankSlipUrl: 'https://asaas.com/boleto/123',
        asaasPaymentId: 'pay_123',
        dueDate: new Date('2024-01-15'),
        subscription: { asaasSubscriptionId: 'sub_123' },
      });

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBe('https://asaas.com/invoice/123');
      expect(result.dueDate).toEqual(new Date('2024-01-15'));
    });

    it('should fallback to bankSlipUrl when invoiceUrl is null', async () => {
      (mockPrismaService as any).payment.findFirst.mockResolvedValue({
        invoiceUrl: null,
        bankSlipUrl: 'https://asaas.com/boleto/123',
        asaasPaymentId: 'pay_123',
        dueDate: new Date('2024-01-15'),
        subscription: { asaasSubscriptionId: 'sub_123' },
      });

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBe('https://asaas.com/boleto/123');
    });

    it('should construct URL from asaasPaymentId when no URLs available', async () => {
      (mockPrismaService as any).payment.findFirst.mockResolvedValue({
        invoiceUrl: null,
        bankSlipUrl: null,
        asaasPaymentId: 'pay_abc123',
        dueDate: new Date('2024-01-15'),
        subscription: { asaasSubscriptionId: 'sub_123' },
      });

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBe('https://www.asaas.com/i/pay_abc123');
    });

    it('should return null when no payments found', async () => {
      (mockPrismaService as any).payment.findFirst.mockResolvedValue(null);
      (mockPrismaService as any).subscription = {
        findFirst: jest.fn().mockResolvedValue(null),
      };

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBeNull();
      expect(result.dueDate).toBeNull();
    });

    it('should fallback to subscription portal URL when no payment URLs', async () => {
      (mockPrismaService as any).payment.findFirst.mockResolvedValue({
        invoiceUrl: null,
        bankSlipUrl: null,
        asaasPaymentId: null,
        dueDate: new Date('2024-01-15'),
        subscription: { asaasSubscriptionId: 'sub_xyz' },
      });

      const result = await service.getPendingPaymentUrl('company-1');

      expect(result.paymentUrl).toBe('https://www.asaas.com/c/sub_xyz');
    });
  });
});
