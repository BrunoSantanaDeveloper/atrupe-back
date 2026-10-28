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
    subscriptionHistory: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockAsaasGatewayService = {
    getAsaasSubscriptionPayments: jest.fn(),
    getAsaasSubscription: jest.fn(),
    getAsaasPayment: jest.fn(),
    getSubscriptionPayments: jest.fn(),
    getInstallmentPayments: jest.fn(),
    mapAsaasPaymentStatus: jest.fn((status: string) => status),
    deleteAsaasPayment: jest.fn(),
    cancelAsaasSubscription: jest.fn(),
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
    // Nenhuma contratação esperando o pagamento, salvo quando o teste diz.
    mockPrismaService.subscription.findFirst.mockResolvedValue(null);
    mockPrismaService.subscriptionHistory.findMany.mockResolvedValue([]);
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

    const local = (
      asaasPaymentId: string,
      status = 'OVERDUE',
      dueDate = '2026-04-04',
    ) => ({
      id: `local-${asaasPaymentId}`,
      subscriptionId: 'sub-local',
      asaasPaymentId,
      status,
      dueDate: new Date(`${dueDate}T00:00:00Z`),
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
          local('pay_outubro', 'OVERDUE', '2026-10-04'),
        );
        mockPrismaService.payment.findMany.mockResolvedValue([
          local('pay_outubro', 'OVERDUE', '2026-10-04'),
          local('pay_abril'),
          local('pay_avulsa', 'PENDING'),
        ]);
        mockAsaasGatewayService.getAsaasPayment.mockImplementation((id) =>
          Promise.resolve(
            id === 'pay_abril'
              ? { id, status: 'OVERDUE', deleted: true }
              : { id, status: 'PENDING', deleted: false },
          ),
        );

        const counts = await (service as any).syncMissingPayments(
          'sub-local',
          'sub_asaas',
          listed,
        );

        expect(counts).toEqual({
          created: 0,
          updated: 0,
          canceled: 1,
          activated: 0,
        });

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
          local('pay_a'),
          local('pay_b'),
        ]);
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
          local('pay_abril'),
        ]);
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

    describe('superadmin: prévia e sincronização das cobranças da empresa', () => {
      const listed = [
        // Atrasada no Asaas, pendente aqui: atualizar.
        {
          id: 'pay_outubro',
          status: 'OVERDUE',
          dueDate: '2026-10-04',
          value: 147,
          customer: 'cus_1',
        },
        // Igual nos dois; só o link falta aqui: não é divergência.
        {
          id: 'pay_novembro',
          status: 'PENDING',
          dueDate: '2026-11-04',
          value: 147,
          customer: 'cus_1',
          invoiceUrl: 'https://asaas/i/nov',
        },
        // Só no Asaas: criar.
        {
          id: 'pay_dezembro',
          status: 'PENDING',
          dueDate: '2026-12-04',
          value: 147,
          customer: 'cus_1',
        },
      ];

      beforeEach(() => {
        mockPrismaService.subscription.findMany.mockResolvedValue([
          {
            id: 'sub-local',
            asaasSubscriptionId: 'sub_asaas',
            asaasInstallmentId: null,
          },
        ]);
        mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue(
          listed,
        );
        mockPrismaService.payment.findFirst.mockImplementation(({ where }) =>
          Promise.resolve(
            where.asaasPaymentId === 'pay_outubro'
              ? local('pay_outubro', 'PENDING', '2026-10-04')
              : where.asaasPaymentId === 'pay_novembro'
                ? local('pay_novembro', 'PENDING', '2026-11-04')
                : null,
          ),
        );
        // Em aberto aqui: abril (removida no Asaas), outubro e novembro.
        mockPrismaService.payment.findMany.mockResolvedValue([
          local('pay_abril'),
          local('pay_outubro', 'PENDING', '2026-10-04'),
          local('pay_novembro', 'PENDING', '2026-11-04'),
        ]);
        mockAsaasGatewayService.getAsaasPayment.mockResolvedValue({
          id: 'pay_abril',
          status: 'OVERDUE',
          deleted: true,
        });
      });

      it('a prévia lista só o que diverge e não grava nada', async () => {
        const divergences = await service.previewCompanyCharges('company-1');

        expect(divergences).toEqual([
          expect.objectContaining({
            asaasPaymentId: 'pay_abril',
            dueDate: '2026-04-04',
            localStatus: 'OVERDUE',
            asaasStatus: 'REMOVED',
            action: 'cancel',
          }),
          expect.objectContaining({
            asaasPaymentId: 'pay_outubro',
            dueDate: '2026-10-04',
            localStatus: 'PENDING',
            asaasStatus: 'OVERDUE',
            action: 'update',
          }),
          expect.objectContaining({
            asaasPaymentId: 'pay_dezembro',
            dueDate: '2026-12-04',
            localStatus: null,
            asaasStatus: 'PENDING',
            action: 'create',
          }),
        ]);
        expect(mockPrismaService.subscription.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ companyId: 'company-1' }),
          }),
        );
        expect(mockPrismaService.payment.update).not.toHaveBeenCalled();
        expect(mockPrismaService.payment.create).not.toHaveBeenCalled();
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });

      it('a sincronização aplica o mesmo plano e registra quem disparou', async () => {
        const counts = await service.syncCompanyCharges('company-1', {
          id: 'admin-1',
          name: 'Ana (Sincronizar com Asaas)',
        });

        // Atualizadas: outubro (status) e novembro (link).
        expect(counts).toEqual({
          created: 1,
          updated: 2,
          canceled: 1,
          activated: 0,
        });
        expect(mockPrismaService.payment.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'local-pay_outubro' },
            data: expect.objectContaining({ status: 'OVERDUE' }),
          }),
        );
        expect(mockPrismaService.payment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              asaasPaymentId: 'pay_dezembro',
              subscriptionId: 'sub-local',
            }),
          }),
        );
        expect(tx.payment.update).toHaveBeenCalledWith({
          where: { id: 'local-pay_abril' },
          data: { status: 'CANCELED' },
        });
        expect(tx.subscriptionHistory.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              createdBy: 'admin-1',
              createdByName: 'Ana (Sincronizar com Asaas)',
            }),
          }),
        );
      });

      it('Asaas sem resposta interrompe a sincronização com erro', async () => {
        mockAsaasGatewayService.getAsaasSubscriptionPayments.mockRejectedValue(
          new Error('timeout'),
        );

        await expect(service.syncCompanyCharges('company-1')).rejects.toThrow(
          'timeout',
        );
        expect(mockPrismaService.payment.update).not.toHaveBeenCalled();
        expect(tx.payment.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('contratação que espera o pagamento (regra de 20/10)', () => {
    const tx = {
      subscription: {
        updateMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      subscriptionHistory: { create: jest.fn() },
    };
    const CONTRACTED = {
      action: 'CONTRACTED',
      metadata: { accessAfterPayment: true, paymentId: 'pay_contrato' },
    };
    const ACTOR = { id: 'admin-1', name: 'Ana (Sincronizar com Asaas)' };
    const PAID_IN_ASAAS = [
      {
        id: 'pay_contrato',
        status: 'RECEIVED',
        dueDate: '2026-10-22',
        value: 147,
        customer: 'cus_1',
      },
    ];

    /** A contratação INACTIVE; `otherPlan`, um plano pago já em vigor. */
    const contract = (otherPlan: { id: string } | null = null) =>
      mockPrismaService.subscription.findFirst.mockImplementation(
        ({ where }: any) =>
          Promise.resolve(
            where.id === 'sub-contrato'
              ? { id: 'sub-contrato', companyId: 'company-1' }
              : otherPlan,
          ),
      );

    /** A cobrança da contratação aqui, no status dado, e se há uma paga. */
    const contractCharge = (localStatus: string, paid: boolean) =>
      mockPrismaService.payment.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.asaasPaymentId
            ? {
                id: 'local-contrato',
                subscriptionId: 'sub-contrato',
                asaasPaymentId: 'pay_contrato',
                status: localStatus,
                invoiceUrl: 'https://asaas/i/contrato',
                bankSlipUrl: 'https://asaas/b/contrato',
                confirmedDate: null,
                paymentDate: null,
              }
            : paid
              ? { asaasPaymentId: 'pay_contrato' }
              : null,
        ),
      );

    beforeEach(() => {
      tx.subscription.updateMany.mockReset();
      tx.subscription.findMany.mockReset();
      tx.subscription.update.mockReset();
      tx.subscriptionHistory.create.mockReset();
      tx.subscription.updateMany.mockResolvedValue({ count: 1 });
      tx.subscription.findMany.mockResolvedValue([{ id: 'sub-teste' }]);
      mockPrismaService.$transaction.mockImplementation((fn: any) => fn(tx));
      contract();
      mockPrismaService.subscriptionHistory.findMany.mockResolvedValue([
        CONTRACTED,
      ]);
      mockPrismaService.payment.findFirst.mockResolvedValue({
        asaasPaymentId: 'pay_contrato',
      });
    });

    it('paga: libera o plano e encerra o teste gratuito', async () => {
      expect(await service.activateIfContractPaid('sub-contrato', ACTOR)).toBe(
        'activated',
      );

      // Condicional: só troca se ainda estiver INACTIVE.
      expect(tx.subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 'sub-contrato', status: 'INACTIVE' },
        data: { status: 'ACTIVE' },
      });
      expect(tx.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-teste' },
        data: { status: 'INACTIVE' },
      });
      expect(tx.subscriptionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: 'sub-teste',
          action: 'DEACTIVATED',
        }),
      });
      expect(tx.subscriptionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: 'sub-contrato',
          action: 'ACTIVATED',
          metadata: { paymentId: 'pay_contrato' },
          createdBy: 'admin-1',
          createdByName: 'Ana (Sincronizar com Asaas)',
        }),
      });
    });

    it('sem cobrança paga: segue esperando, e nada muda', async () => {
      mockPrismaService.payment.findFirst.mockResolvedValue(null);

      expect(await service.activateIfContractPaid('sub-contrato')).toBe(
        'awaiting_payment',
      );
      expect(mockPrismaService.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            subscriptionId: 'sub-contrato',
            status: { in: ['CONFIRMED', 'RECEIVED'] },
          },
        }),
      );
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      [
        'contratada antes da regra (sem a marca)',
        [{ action: 'CONTRACTED', metadata: { paymentId: 'pay_contrato' } }],
        'not_applicable',
      ],
      [
        'já liberada uma vez',
        [CONTRACTED, { action: 'ACTIVATED', metadata: null }],
        'held',
      ],
      [
        'desativada à mão pelo superadmin',
        [
          CONTRACTED,
          { action: 'STATUS_CHANGE', metadata: { newStatus: 'INACTIVE' } },
        ],
        'held',
      ],
    ])('%s: o pagamento não a libera', async (_caso, history, expected) => {
      mockPrismaService.subscriptionHistory.findMany.mockResolvedValue(history);

      expect(await service.activateIfContractPaid('sub-contrato')).toBe(
        expected,
      );
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      [
        'da regra antiga que passou a esperar o pagamento',
        [
          { action: 'CONTRACTED', metadata: { paymentId: 'pay_contrato' } },
          {
            action: 'ACCESS_AFTER_PAYMENT',
            metadata: { accessAfterPayment: true },
          },
        ],
      ],
      [
        'ativada antes da marca (só vale o que veio depois dela)',
        [
          { action: 'ACTIVATED', metadata: null },
          {
            action: 'ACCESS_AFTER_PAYMENT',
            metadata: { accessAfterPayment: true },
          },
        ],
      ],
    ])('contratação %s: paga, é liberada', async (_caso, history) => {
      mockPrismaService.subscriptionHistory.findMany.mockResolvedValue(history);

      expect(await service.activateIfContractPaid('sub-contrato')).toBe(
        'activated',
      );
    });

    it('com outro plano pago em vigor na empresa, não libera', async () => {
      contract({ id: 'sub-manual' });

      expect(await service.activateIfContractPaid('sub-contrato')).toBe('held');
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('duas conferências ao mesmo tempo: só uma libera', async () => {
      tx.subscription.updateMany.mockResolvedValue({ count: 0 });

      expect(await service.activateIfContractPaid('sub-contrato')).toBe(
        'not_applicable',
      );
      expect(tx.subscription.update).not.toHaveBeenCalled();
      expect(tx.subscriptionHistory.create).not.toHaveBeenCalled();
    });

    it('o alinhamento libera a contratação que acabou de ser paga', async () => {
      // Paga no Asaas, pendente aqui.
      contractCharge('PENDING', true);

      const counts = await (service as any).syncMissingPayments(
        'sub-contrato',
        'sub_asaas',
        PAID_IN_ASAAS,
        ACTOR,
      );

      expect(counts).toEqual({
        created: 0,
        updated: 1,
        canceled: 0,
        activated: 1,
      });
      expect(mockPrismaService.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'local-contrato' },
          data: expect.objectContaining({ status: 'RECEIVED' }),
        }),
      );
      // Alinha primeiro, libera depois.
      expect(
        mockPrismaService.payment.update.mock.invocationCallOrder[0],
      ).toBeLessThan(tx.subscription.updateMany.mock.invocationCallOrder[0]);
    });

    it('falha ao liberar não desfaz nem derruba o alinhamento', async () => {
      contractCharge('PENDING', true);
      mockPrismaService.$transaction.mockRejectedValue(new Error('banco fora'));

      const counts = await (service as any).syncMissingPayments(
        'sub-contrato',
        'sub_asaas',
        PAID_IN_ASAAS,
      );

      expect(counts).toEqual({
        created: 0,
        updated: 1,
        canceled: 0,
        activated: 0,
      });
    });

    it('a rotina das 03:00 desbloqueia sem ativar a contratação que ainda espera o pagamento', async () => {
      mockPrismaService.company.findMany.mockResolvedValue([
        {
          id: 'company-1',
          name: 'Empresa',
          blockLevel: 'PARTIAL',
          blockReason: 'Assinatura com 3 dias de atraso (verificado no Asaas)',
          Subscription: [
            {
              id: 'sub-contrato',
              asaasSubscriptionId: 'sub_asaas',
              asaasInstallmentId: null,
              billingMode: null,
              nextDueDate: new Date(),
              status: 'INACTIVE',
            },
          ],
        },
      ]);
      // A primeira cobrança vence em dois dias: nada vencido, nada pago.
      const inTwoDays = new Date(Date.now() + 2 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        {
          id: 'pay_contrato',
          status: 'PENDING',
          dueDate: inTwoDays,
          value: 147,
          customer: 'cus_1',
          invoiceUrl: 'https://asaas/i/contrato',
          bankSlipUrl: 'https://asaas/b/contrato',
        },
      ]);
      contractCharge('PENDING', false);

      const [result] = await service.checkAndUnblockCompanies();

      expect(result.action).toBe('unblocked');
      expect(mockPrismaService.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'company-1' },
          data: expect.objectContaining({ blockLevel: 'NONE' }),
        }),
      );
      // Sem vencida não quer dizer paga: a assinatura segue INACTIVE.
      expect(mockPrismaService.subscription.update).not.toHaveBeenCalled();
      expect(tx.subscription.updateMany).not.toHaveBeenCalled();
    });
  });
  describe('evolução paga e contratação nunca paga (regra de 20/10)', () => {
    const tx = {
      subscription: {
        updateMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      payment: { updateMany: jest.fn() },
      couponUsage: { deleteMany: jest.fn() },
      coupon: { update: jest.fn() },
      subscriptionHistory: { create: jest.fn() },
    };
    const ACTOR = { id: 'admin-1', name: 'Ana (Sincronizar com Asaas)' };
    const MARKED = { accessAfterPayment: true };

    /** As assinaturas que o "banco" conhece, por id. */
    let subscriptions: Record<string, any>;
    /** O histórico de cada assinatura. */
    let histories: Record<string, any[]>;
    /** As cobranças locais, pelo id do Asaas. */
    let localCharges: Record<string, any>;
    /** As cobranças de cada assinatura no Asaas. */
    let asaasCharges: Record<string, any[]>;
    /** Assinaturas com cobrança paga aqui. */
    let paid: Set<string>;

    const local = (id: string, subscriptionId: string, status: string) => ({
      id: `local-${id}`,
      subscriptionId,
      asaasPaymentId: id,
      status,
      invoiceUrl: `https://asaas/i/${id}`,
      bankSlipUrl: `https://asaas/b/${id}`,
      confirmedDate: null,
      paymentDate: null,
    });

    beforeEach(() => {
      for (const fn of [
        tx.subscription.updateMany,
        tx.subscription.findMany,
        tx.subscription.update,
        tx.payment.updateMany,
        tx.couponUsage.deleteMany,
        tx.coupon.update,
        tx.subscriptionHistory.create,
      ]) {
        fn.mockReset();
      }
      tx.subscription.updateMany.mockResolvedValue({ count: 1 });
      tx.subscription.findMany.mockResolvedValue([]);
      tx.payment.updateMany.mockResolvedValue({ count: 1 });
      tx.couponUsage.deleteMany.mockResolvedValue({ count: 1 });
      mockPrismaService.$transaction.mockImplementation((fn: any) => fn(tx));
      mockAsaasGatewayService.deleteAsaasPayment.mockReset();
      mockAsaasGatewayService.cancelAsaasSubscription.mockReset();
      mockAsaasGatewayService.deleteAsaasPayment.mockResolvedValue(undefined);
      mockAsaasGatewayService.cancelAsaasSubscription.mockResolvedValue(
        undefined,
      );

      subscriptions = {
        'sub-start': {
          id: 'sub-start',
          status: 'ACTIVE',
          companyId: 'company-1',
          previousSubscriptionId: null,
          asaasSubscriptionId: 'sub_old',
          asaasInstallmentId: null,
          billingMode: null,
          plan: { name: 'Atrupe Start' },
        },
        'sub-lite': {
          id: 'sub-lite',
          status: 'INACTIVE',
          companyId: 'company-1',
          previousSubscriptionId: 'sub-start',
          asaasSubscriptionId: 'sub_lite',
          asaasInstallmentId: null,
          billingMode: null,
          plan: { name: 'Atrupe Lite' },
        },
        'sub-contrato': {
          id: 'sub-contrato',
          status: 'INACTIVE',
          companyId: 'company-2',
          previousSubscriptionId: null,
          asaasSubscriptionId: 'sub_contrato',
          asaasInstallmentId: null,
          billingMode: null,
          plan: { name: 'Atrupe Start' },
        },
      };
      histories = {
        'sub-lite': [{ action: 'EVOLUTION_CONTRACTED', metadata: MARKED }],
        'sub-contrato': [{ action: 'CONTRACTED', metadata: MARKED }],
      };
      localCharges = {
        pay_evolucao: local('pay_evolucao', 'sub-lite', 'OVERDUE'),
        pay_contrato: local('pay_contrato', 'sub-contrato', 'OVERDUE'),
      };
      asaasCharges = {
        sub_old: [
          { id: 'pay_old_next', status: 'PENDING', dueDate: '2099-01-15' },
          { id: 'pay_old_paid', status: 'RECEIVED', dueDate: '2000-01-15' },
        ],
        sub_lite: [
          {
            id: 'pay_evolucao',
            status: 'OVERDUE',
            dueDate: '2026-10-28',
            invoiceUrl: 'https://asaas/i/pay_evolucao',
            bankSlipUrl: 'https://asaas/b/pay_evolucao',
          },
        ],
        sub_contrato: [
          {
            id: 'pay_contrato',
            status: 'OVERDUE',
            dueDate: '2026-10-28',
            invoiceUrl: 'https://asaas/i/pay_contrato',
            bankSlipUrl: 'https://asaas/b/pay_contrato',
          },
        ],
      };
      paid = new Set();

      // Como o banco: o filtro por id, por status e por "ainda não paga".
      mockPrismaService.subscription.findFirst.mockImplementation(
        ({ where }: any) => {
          if (typeof where.id !== 'string') return Promise.resolve(null);
          const sub = subscriptions[where.id];
          if (!sub) return Promise.resolve(null);
          if (where.status && where.status !== sub.status) {
            return Promise.resolve(null);
          }
          if (where.payments && paid.has(where.id)) {
            return Promise.resolve(null);
          }
          return Promise.resolve(sub);
        },
      );
      mockPrismaService.subscriptionHistory.findMany.mockImplementation(
        ({ where }: any) =>
          Promise.resolve(
            (histories[where.subscriptionId] ?? []).filter((h) =>
              where.action.in.includes(h.action),
            ),
          ),
      );
      mockPrismaService.payment.findFirst.mockImplementation(
        ({ where }: any) => {
          if (where.asaasPaymentId) {
            return Promise.resolve(localCharges[where.asaasPaymentId] ?? null);
          }
          if (where.subscriptionId && where.status?.in) {
            return Promise.resolve(
              paid.has(where.subscriptionId)
                ? { asaasPaymentId: `pay_${where.subscriptionId}` }
                : null,
            );
          }
          return Promise.resolve(null);
        },
      );
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockImplementation(
        (id: string) => Promise.resolve(asaasCharges[id] ?? []),
      );
    });

    describe('evolução paga: a troca de plano', () => {
      beforeEach(() => paid.add('sub-lite'));

      it('o plano anterior deixa de cobrar no Asaas e sai; o novo entra', async () => {
        expect(await service.activateIfContractPaid('sub-lite', ACTOR)).toBe(
          'activated',
        );

        // No Asaas, só a renovação em aberto da anterior sai; a paga fica.
        expect(
          mockAsaasGatewayService.deleteAsaasPayment,
        ).toHaveBeenCalledTimes(1);
        expect(mockAsaasGatewayService.deleteAsaasPayment).toHaveBeenCalledWith(
          'pay_old_next',
        );
        expect(
          mockAsaasGatewayService.cancelAsaasSubscription,
        ).toHaveBeenCalledWith('sub_old');
        // E só depois, aqui.
        expect(
          mockAsaasGatewayService.cancelAsaasSubscription.mock
            .invocationCallOrder[0],
        ).toBeLessThan(tx.subscription.updateMany.mock.invocationCallOrder[0]);
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
          where: { id: 'sub-lite', status: 'INACTIVE' },
          data: { status: 'ACTIVE' },
        });
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
          where: { id: 'sub-start', status: 'ACTIVE' },
          data: { status: 'CANCELED', endedReason: 'EVOLVED' },
        });
        expect(tx.payment.updateMany).toHaveBeenCalledWith({
          where: {
            subscriptionId: 'sub-start',
            status: { in: ['PENDING', 'OVERDUE'] },
          },
          data: { status: 'CANCELED' },
        });
        expect(tx.subscriptionHistory.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            subscriptionId: 'sub-start',
            action: 'EVOLVED',
          }),
        });
        expect(tx.subscriptionHistory.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            subscriptionId: 'sub-lite',
            action: 'ACTIVATED',
            description: 'Evolução do Atrupe Start liberada com o pagamento',
          }),
        });
      });

      it('o plano que a evolução substitui não conta como "outro plano em vigor"', async () => {
        await service.activateIfContractPaid('sub-lite');

        expect(mockPrismaService.subscription.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: { notIn: ['sub-lite', 'sub-start'] },
              status: 'ACTIVE',
            }),
          }),
        );
      });

      it('com o Asaas fora, nada troca: a próxima conferência tenta de novo', async () => {
        mockAsaasGatewayService.cancelAsaasSubscription.mockRejectedValue(
          new Error('Asaas fora'),
        );

        expect(await service.activateIfContractPaid('sub-lite')).toBe(
          'awaiting_payment',
        );
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });
    });

    describe('contratação nunca paga, vencida há 7 dias', () => {
      // 04/11, 03:00 local: a cobrança de 28/10 está vencida há 7 dias.
      const NOW = new Date(2026, 10, 4, 3, 0, 0);
      const candidate = (id: string, overrides: Record<string, any> = {}) => ({
        id,
        status: subscriptions[id].status,
        companyId: subscriptions[id].companyId,
        previousSubscriptionId: subscriptions[id].previousSubscriptionId,
        couponId: null,
        asaasSubscriptionId: subscriptions[id].asaasSubscriptionId,
        asaasInstallmentId: null,
        billingMode: null,
        Company: { blockLevel: 'NONE', blockReason: null },
        ...overrides,
      });

      it('desfaz a contratação: encerra no Asaas, cancela aqui e devolve o cupom', async () => {
        mockPrismaService.subscription.findMany.mockResolvedValue([
          candidate('sub-contrato', { couponId: 'coupon-1' }),
        ]);

        expect(await service.cancelUnpaidContracts(NOW)).toEqual([
          'sub-contrato',
        ]);

        // Só quem tem cobrança aberta vencida até 28/10 e nenhuma paga.
        expect(mockPrismaService.subscription.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: { in: ['ACTIVE', 'INACTIVE'] },
              contractedAt: { not: null },
              endedReason: null,
              payments: {
                none: { status: { in: ['CONFIRMED', 'RECEIVED'] } },
                some: {
                  status: { in: ['PENDING', 'OVERDUE'] },
                  dueDate: { lte: new Date('2026-10-28T00:00:00.000Z') },
                },
              },
            }),
          }),
        );
        expect(mockAsaasGatewayService.deleteAsaasPayment).toHaveBeenCalledWith(
          'pay_contrato',
        );
        expect(
          mockAsaasGatewayService.cancelAsaasSubscription,
        ).toHaveBeenCalledWith('sub_contrato');
        expect(tx.subscription.update).toHaveBeenCalledWith({
          where: { id: 'sub-contrato' },
          data: { status: 'CANCELED', endedReason: 'UNPAID' },
        });
        expect(tx.payment.updateMany).toHaveBeenCalledWith({
          where: {
            subscriptionId: 'sub-contrato',
            status: { in: ['PENDING', 'OVERDUE'] },
          },
          data: { status: 'CANCELED' },
        });
        expect(tx.coupon.update).toHaveBeenCalledWith({
          where: { id: 'coupon-1' },
          data: { currentUses: { decrement: 1 } },
        });
        expect(tx.subscriptionHistory.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            subscriptionId: 'sub-contrato',
            action: 'CANCELED',
            metadata: expect.objectContaining({ reason: 'UNPAID' }),
          }),
        });
        // A empresa não estava bloqueada.
        expect(mockPrismaService.company.update).not.toHaveBeenCalled();
      });

      it('paga na conferência final: é liberada, não desfeita', async () => {
        mockPrismaService.subscription.findMany.mockResolvedValue([
          candidate('sub-contrato'),
        ]);
        asaasCharges.sub_contrato[0].status = 'RECEIVED';
        mockPrismaService.payment.update.mockImplementation(() => {
          paid.add('sub-contrato');
          return Promise.resolve({});
        });

        expect(await service.cancelUnpaidContracts(NOW)).toEqual([]);
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
          where: { id: 'sub-contrato', status: 'INACTIVE' },
          data: { status: 'ACTIVE' },
        });
        expect(
          mockAsaasGatewayService.cancelAsaasSubscription,
        ).not.toHaveBeenCalled();
        expect(tx.subscription.update).not.toHaveBeenCalled();
      });

      it('evolução nunca paga: só ela é desfeita; o plano em curso segue', async () => {
        mockPrismaService.subscription.findMany.mockResolvedValue([
          candidate('sub-lite'),
        ]);

        expect(await service.cancelUnpaidContracts(NOW)).toEqual(['sub-lite']);
        expect(
          mockAsaasGatewayService.cancelAsaasSubscription,
        ).toHaveBeenCalledTimes(1);
        expect(
          mockAsaasGatewayService.cancelAsaasSubscription,
        ).toHaveBeenCalledWith('sub_lite');
        expect(tx.subscription.update).toHaveBeenCalledTimes(1);
        expect(tx.subscription.update).toHaveBeenCalledWith({
          where: { id: 'sub-lite' },
          data: { status: 'CANCELED', endedReason: 'UNPAID' },
        });
      });

      it('da regra antiga, ativa e nunca paga, bloqueada pela dívida: desfeita e desbloqueada', async () => {
        subscriptions['sub-contrato'].status = 'ACTIVE';
        mockPrismaService.subscription.findMany.mockResolvedValue([
          candidate('sub-contrato', {
            status: 'ACTIVE',
            Company: {
              blockLevel: 'FULL',
              blockReason:
                'Assinatura com 33 dias de atraso (verificado no Asaas)',
            },
          }),
        ]);

        expect(await service.cancelUnpaidContracts(NOW)).toEqual([
          'sub-contrato',
        ]);
        expect(mockPrismaService.company.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'company-2' },
            data: expect.objectContaining({ blockLevel: 'NONE' }),
          }),
        );
        expect(mockPrismaService.companyHistory.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            companyId: 'company-2',
            action: 'UNBLOCKED',
          }),
        });
      });

      it.each([
        [
          'bloqueada à mão',
          {
            status: 'ACTIVE',
            Company: {
              blockLevel: 'FULL',
              blockReason: 'Inativação manual por Ana',
            },
          },
        ],
        [
          'vinda de transferência',
          { status: 'ACTIVE', previousSubscriptionId: 'sub-anterior' },
        ],
      ])('da regra antiga %s: fica como está', async (_caso, overrides) => {
        subscriptions['sub-contrato'].status = 'ACTIVE';
        mockPrismaService.subscription.findMany.mockResolvedValue([
          candidate('sub-contrato', overrides),
        ]);

        expect(await service.cancelUnpaidContracts(NOW)).toEqual([]);
        expect(
          mockAsaasGatewayService.cancelAsaasSubscription,
        ).not.toHaveBeenCalled();
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });

      it('retida pelo superadmin: fica como está', async () => {
        histories['sub-contrato'].push({
          action: 'STATUS_CHANGE',
          metadata: { newStatus: 'INACTIVE' },
        });
        mockPrismaService.subscription.findMany.mockResolvedValue([
          candidate('sub-contrato'),
        ]);

        expect(await service.cancelUnpaidContracts(NOW)).toEqual([]);
        expect(
          mockAsaasGatewayService.cancelAsaasSubscription,
        ).not.toHaveBeenCalled();
      });

      it('o Asaas fora numa não desfaz nada nela, e as demais seguem', async () => {
        mockPrismaService.subscription.findMany.mockResolvedValue([
          candidate('sub-lite'),
          candidate('sub-contrato'),
        ]);
        mockAsaasGatewayService.cancelAsaasSubscription.mockImplementation(
          (id: string) =>
            id === 'sub_lite'
              ? Promise.reject(new Error('Asaas fora'))
              : Promise.resolve(),
        );

        expect(await service.cancelUnpaidContracts(NOW)).toEqual([
          'sub-contrato',
        ]);
        expect(tx.subscription.update).toHaveBeenCalledTimes(1);
        expect(tx.subscription.update).toHaveBeenCalledWith({
          where: { id: 'sub-contrato' },
          data: { status: 'CANCELED', endedReason: 'UNPAID' },
        });
      });
    });
  });
});
