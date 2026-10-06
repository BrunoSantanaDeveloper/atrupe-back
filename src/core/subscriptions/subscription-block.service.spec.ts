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
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    subscriptionHistory: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockAsaasGatewayService = {
    getAsaasSubscriptionPayments: jest.fn(),
    getAsaasSubscription: jest.fn(),
    getAsaasPayment: jest.fn(),
    getSubscriptionPayments: jest.fn(),
    getInstallmentPayments: jest.fn(),
    mapAsaasPaymentStatus: jest.fn((status: string) => status),
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
    // A assinatura segue viva no Asaas, salvo quando o teste diz o contrário.
    mockAsaasGatewayService.getAsaasSubscription.mockResolvedValue({
      status: 'ACTIVE',
      deleted: false,
    });
    // Nenhuma cobrança local em aberto fora da listagem, salvo quando o teste diz.
    mockPrismaService.payment.findMany.mockResolvedValue([]);
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

    it('assinatura removida no Asaas é encerrada, com as mensalidades locais em aberto', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-r',
          name: 'Removida',
          blockLevel: 'NONE',
          Subscription: [
            {
              id: 'sub-local-r',
              asaasSubscriptionId: 'sub_rem',
              nextDueDate: new Date(),
            },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscription.mockResolvedValue({
        status: 'ACTIVE',
        deleted: true,
      });
      // A de uma assinatura removida ainda lista as já pagas.
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'RECEIVED', dueDate: makeDueDate(90) },
      ]);
      const tx = {
        subscription: { update: jest.fn() },
        payment: { updateMany: jest.fn() },
        subscriptionHistory: { create: jest.fn() },
      };
      mockPrismaService.$transaction.mockImplementation(async (cb) => cb(tx));

      const results = await service.checkAndApplyBlocks();

      expect(results[0].action).toBe('ended');
      expect(tx.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-local-r' },
        data: { status: 'CANCELED', endedReason: 'GATEWAY_REMOVED' },
      });
      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-local-r',
          status: { in: ['PENDING', 'OVERDUE'] },
        },
        data: { status: 'CANCELED' },
      });
      expect(mockPrismaService.company.update).not.toHaveBeenCalled();
    });

    it('falha ao consultar a assinatura no Asaas não encerra nada', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-f',
          name: 'Falha',
          blockLevel: 'NONE',
          Subscription: [
            {
              id: 'sub-local-f',
              asaasSubscriptionId: 'sub_f',
              nextDueDate: new Date(),
            },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscription.mockRejectedValue(
        new Error('timeout'),
      );
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'RECEIVED', dueDate: makeDueDate(10) },
      ]);

      const results = await service.checkAndApplyBlocks();

      expect(results[0].action).not.toBe('ended');
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('confere a assinatura paga, não o teste gratuito que ficou ativo', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-t',
          name: 'Teste e paga',
          blockLevel: 'NONE',
          Subscription: [
            {
              id: 'trial-1',
              asaasSubscriptionId: 'trial_sub_1',
              nextDueDate: new Date(),
            },
            {
              id: 'paga-1',
              asaasSubscriptionId: 'sub_paga',
              nextDueDate: new Date(),
            },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'OVERDUE', dueDate: makeDueDate(4) },
      ]);
      mockPrismaService.company.update.mockResolvedValue({});

      const results = await service.checkAndApplyBlocks();

      expect(results[0].newBlockLevel).toBe('PARTIAL');
      expect(
        mockAsaasGatewayService.getAsaasSubscriptionPayments,
      ).toHaveBeenCalledWith('sub_paga');
    });

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

    it('6 dias de atraso ainda é bloqueio parcial (o total vem depois de passados 6 dias)', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-6',
          name: 'Seis dias',
          blockLevel: 'NONE',
          Subscription: [
            { asaasSubscriptionId: 'sub_666', nextDueDate: new Date() },
          ],
        },
      ]);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { status: 'OVERDUE', dueDate: makeDueDate(6) },
      ]);
      mockPrismaService.company.update.mockResolvedValue({});

      const results = await service.checkAndApplyBlocks();

      expect(results[0].daysOverdue).toBe(6);
      expect(results[0].newBlockLevel).toBe('PARTIAL');
    });

    it('aplica o bloqueio total a partir do 7º dia de atraso (contrato, 7.4)', async () => {
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

  describe('cobrança removida no Asaas', () => {
    const tx = {
      payment: { update: jest.fn() },
      subscriptionHistory: { create: jest.fn() },
    };

    const local = (asaasPaymentId: string, status = 'OVERDUE') => ({
      id: `local-${asaasPaymentId}`,
      subscriptionId: 'sub-local',
      asaasPaymentId,
      status,
      dueDate: new Date('2026-04-04T00:00:00Z'),
      value: 147,
      invoiceUrl: null,
      bankSlipUrl: null,
      confirmedDate: null,
      paymentDate: null,
    });

    beforeEach(() => {
      tx.payment.update.mockReset();
      tx.subscriptionHistory.create.mockReset();
      mockPrismaService.$transaction.mockImplementation((fn: any) => fn(tx));
    });

    describe('refreshLocalCharge', () => {
      it('baixa a pendência quando o Asaas diz que a cobrança foi removida', async () => {
        mockPrismaService.payment.findUnique.mockResolvedValue(
          local('pay_abril'),
        );
        // O Asaas mantém o status de antes da remoção: quem decide é `deleted`.
        mockAsaasGatewayService.getAsaasPayment.mockResolvedValue({
          id: 'pay_abril',
          status: 'OVERDUE',
          deleted: true,
        });

        const result = await service.refreshLocalCharge('pay_abril');

        expect(result).toBe('canceled');
        expect(tx.payment.update).toHaveBeenCalledWith({
          where: { id: 'local-pay_abril' },
          data: { status: 'CANCELED' },
        });
        expect(tx.subscriptionHistory.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              subscriptionId: 'sub-local',
              action: 'PAYMENT_CANCELED',
              description: expect.stringContaining('04/04/2026'),
            }),
          }),
        );
      });

      it('baixa a pendência quando a cobrança não existe no Asaas', async () => {
        mockPrismaService.payment.findUnique.mockResolvedValue(
          local('pay_abril'),
        );
        mockAsaasGatewayService.getAsaasPayment.mockResolvedValue(null);

        expect(await service.refreshLocalCharge('pay_abril')).toBe('canceled');
        expect(tx.payment.update).toHaveBeenCalledWith({
          where: { id: 'local-pay_abril' },
          data: { status: 'CANCELED' },
        });
      });

      it('nunca mexe numa cobrança paga, mesmo removida no Asaas', async () => {
        mockPrismaService.payment.findUnique.mockResolvedValue(
          local('pay_abril', 'RECEIVED'),
        );
        mockAsaasGatewayService.getAsaasPayment.mockResolvedValue({
          id: 'pay_abril',
          status: 'RECEIVED',
          deleted: true,
        });

        expect(await service.refreshLocalCharge('pay_abril')).toBe('unchanged');
        expect(tx.payment.update).not.toHaveBeenCalled();
        expect(mockPrismaService.payment.update).not.toHaveBeenCalled();
      });

      it('com onlyIfRemoved, não mexe numa cobrança que segue viva no Asaas', async () => {
        mockPrismaService.payment.findUnique.mockResolvedValue(
          local('pay_avulsa', 'PENDING'),
        );
        mockAsaasGatewayService.getAsaasPayment.mockResolvedValue({
          id: 'pay_avulsa',
          status: 'RECEIVED',
          deleted: false,
        });

        expect(
          await service.refreshLocalCharge('pay_avulsa', {
            onlyIfRemoved: true,
          }),
        ).toBe('unchanged');
        expect(tx.payment.update).not.toHaveBeenCalled();
        expect(mockPrismaService.payment.update).not.toHaveBeenCalled();
      });

      it('reabre a cobrança restaurada no Asaas', async () => {
        mockPrismaService.payment.findUnique.mockResolvedValue(
          local('pay_abril', 'CANCELED'),
        );
        mockAsaasGatewayService.getAsaasPayment.mockResolvedValue({
          id: 'pay_abril',
          status: 'OVERDUE',
          deleted: false,
        });

        expect(await service.refreshLocalCharge('pay_abril')).toBe('updated');
        expect(mockPrismaService.payment.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'local-pay_abril' },
            data: expect.objectContaining({ status: 'OVERDUE' }),
          }),
        );
      });

      it('ignora cobrança que não é deste sistema (conta compartilhada com o legado)', async () => {
        mockPrismaService.payment.findUnique.mockResolvedValue(null);

        expect(await service.refreshLocalCharge('pay_legado')).toBe(
          'not_local',
        );
        expect(mockAsaasGatewayService.getAsaasPayment).not.toHaveBeenCalled();
      });

      it('não altera nada quando o Asaas não responde', async () => {
        mockPrismaService.payment.findUnique.mockResolvedValue(
          local('pay_abril'),
        );
        mockAsaasGatewayService.getAsaasPayment.mockRejectedValue(
          new Error('timeout'),
        );

        await expect(service.refreshLocalCharge('pay_abril')).rejects.toThrow(
          'timeout',
        );
        expect(tx.payment.update).not.toHaveBeenCalled();
      });
    });

    describe('sync: cobranças locais em aberto fora da listagem', () => {
      it('confere pelo id só as que não vieram na listagem e baixa só as removidas', async () => {
        // A listagem do Asaas não traz as removidas: só a de outubro vem.
        const listed = [
          {
            id: 'pay_outubro',
            status: 'OVERDUE',
            dueDate: '2026-10-04',
            value: 147,
            customer: 'cus_1',
          },
        ];
        mockPrismaService.payment.findFirst.mockResolvedValue(
          local('pay_outubro'),
        );
        mockPrismaService.payment.findMany.mockResolvedValue([
          { asaasPaymentId: 'pay_outubro' },
          { asaasPaymentId: 'pay_abril' },
          { asaasPaymentId: 'pay_avulsa' },
        ]);
        mockPrismaService.payment.findUnique.mockImplementation(({ where }) =>
          Promise.resolve(
            local(
              where.asaasPaymentId,
              where.asaasPaymentId === 'pay_avulsa' ? 'PENDING' : 'OVERDUE',
            ),
          ),
        );
        mockAsaasGatewayService.getAsaasPayment.mockImplementation((id) =>
          Promise.resolve(
            id === 'pay_abril'
              ? { id, status: 'OVERDUE', deleted: true }
              : { id, status: 'PENDING', deleted: false },
          ),
        );

        await (service as any).syncMissingPayments(
          'sub-local',
          'sub_asaas',
          listed,
        );

        expect(mockPrismaService.payment.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              subscriptionId: 'sub-local',
              status: { in: ['PENDING', 'OVERDUE'] },
              asaasPaymentId: { startsWith: 'pay_' },
            },
          }),
        );
        expect(
          mockAsaasGatewayService.getAsaasPayment,
        ).not.toHaveBeenCalledWith('pay_outubro');
        expect(mockAsaasGatewayService.getAsaasPayment).toHaveBeenCalledWith(
          'pay_abril',
        );
        // A avulsa existe no Asaas: a rotina não a baixa nem a altera.
        expect(mockAsaasGatewayService.getAsaasPayment).toHaveBeenCalledWith(
          'pay_avulsa',
        );
        expect(tx.payment.update).toHaveBeenCalledTimes(1);
        expect(tx.payment.update).toHaveBeenCalledWith({
          where: { id: 'local-pay_abril' },
          data: { status: 'CANCELED' },
        });
        expect(mockPrismaService.payment.update).not.toHaveBeenCalled();
      });

      it('uma falha ao conferir uma cobrança não impede as demais', async () => {
        mockPrismaService.payment.findMany.mockResolvedValue([
          { asaasPaymentId: 'pay_a' },
          { asaasPaymentId: 'pay_b' },
        ]);
        mockPrismaService.payment.findUnique.mockImplementation(({ where }) =>
          Promise.resolve(local(where.asaasPaymentId)),
        );
        mockAsaasGatewayService.getAsaasPayment.mockImplementation((id) =>
          id === 'pay_a'
            ? Promise.reject(new Error('timeout'))
            : Promise.resolve({ id, status: 'OVERDUE', deleted: true }),
        );

        await (service as any).syncMissingPayments(
          'sub-local',
          'sub_asaas',
          [],
        );

        expect(tx.payment.update).toHaveBeenCalledTimes(1);
        expect(tx.payment.update).toHaveBeenCalledWith({
          where: { id: 'local-pay_b' },
          data: { status: 'CANCELED' },
        });
      });

      it('a rotina diária confere mesmo quando a listagem do Asaas vem vazia', async () => {
        mockPrismaService.subscription.findMany.mockResolvedValue([
          {
            id: 'sub-local',
            asaasSubscriptionId: 'sub_asaas',
            asaasInstallmentId: null,
            Company: { name: 'Empresa' },
          },
        ]);
        mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue(
          [],
        );
        mockPrismaService.payment.findMany.mockResolvedValue([
          { asaasPaymentId: 'pay_abril' },
        ]);
        mockPrismaService.payment.findUnique.mockResolvedValue(
          local('pay_abril'),
        );
        mockAsaasGatewayService.getAsaasPayment.mockResolvedValue({
          id: 'pay_abril',
          status: 'OVERDUE',
          deleted: true,
        });

        await (service as any).syncAllCompanyPayments();

        expect(tx.payment.update).toHaveBeenCalledWith({
          where: { id: 'local-pay_abril' },
          data: { status: 'CANCELED' },
        });
      });
    });
  });
});
