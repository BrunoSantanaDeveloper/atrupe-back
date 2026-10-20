import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { SubscriptionBlockService } from './subscription-block.service';

// Mock argon2 globally
jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(),
}));

import * as argon2 from 'argon2';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  const mockPrismaService = {
    user: { findFirst: jest.fn(), findUnique: jest.fn() },
    subscription: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    subscriptionFeature: {
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    subscriptionHistory: { create: jest.fn(), deleteMany: jest.fn() },
    company: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    customer: { delete: jest.fn() },
    employee: { findMany: jest.fn(), deleteMany: jest.fn() },
    plan: { findUnique: jest.fn() },
    feature: { findUnique: jest.fn() },
    planFeature: { findFirst: jest.fn() },
    payment: { deleteMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockAsaasGatewayService = {
    cancelAsaasSubscription: jest.fn(),
    updateAsaasSubscription: jest.fn(),
    getAsaasSubscriptionPayments: jest.fn(),
    getChargesOf: jest.fn(),
    updateAsaasPayment: jest.fn(),
    deleteAsaasPayment: jest.fn(),
  };

  const mockSubscriptionBlockService = {
    unblockCompany: jest.fn(),
    previewCompanyCharges: jest.fn(),
    syncCompanyCharges: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AsaasGatewayService, useValue: mockAsaasGatewayService },
        {
          provide: SubscriptionBlockService,
          useValue: mockSubscriptionBlockService,
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extendTrialPeriod', () => {
    it('should throw UnauthorizedException when admin not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        service.extendTrialPeriod('sub-1', 'password', 'invalid-admin'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.extendTrialPeriod('sub-1', 'wrong-pass', 'admin-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw NotFoundException when subscription not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.extendTrialPeriod('invalid-sub', 'password', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-TRIAL plan', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        plan: { planType: 'START' },
        Company: { name: 'Test' },
      });

      await expect(
        service.extendTrialPeriod('sub-1', 'password', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should extend trial by 7 days from today', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
        name: 'Admin',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const oldDueDate = new Date('2026-01-01');
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        nextDueDate: oldDueDate,
        plan: { planType: 'TRIAL' },
        Company: { name: 'Test Company' },
      });
      mockPrismaService.subscription.update.mockResolvedValue({
        id: 'sub-1',
        plan: { planType: 'TRIAL' },
        Company: { name: 'Test Company' },
        customer: {},
      });

      const result = await service.extendTrialPeriod(
        'sub-1',
        'password',
        'admin-1',
      );

      expect(result.previousDueDate).toEqual(oldDueDate);
      expect(result.newDueDate).toBeDefined();

      // New due date should be ~7 days from now
      const now = new Date();
      const expectedMin = new Date(now);
      expectedMin.setDate(expectedMin.getDate() + 6);
      const expectedMax = new Date(now);
      expectedMax.setDate(expectedMax.getDate() + 8);

      expect(result.newDueDate.getTime()).toBeGreaterThan(
        expectedMin.getTime(),
      );
      expect(result.newDueDate.getTime()).toBeLessThan(expectedMax.getTime());

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            nextDueDate: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('changePlan', () => {
    const currentSubscription = {
      id: 'sub-1',
      companyId: 'company-1',
      planId: 'plan-start',
      asaasSubscriptionId: 'sub_123',
      additionalUsers: 2,
      cycle: 'MONTHLY',
      plan: { name: 'Start' },
      subscriptionFeatures: [
        { isActive: true, price: 7000, feature: { key: 'nota_fiscal' } },
      ],
    };

    const litePlan = {
      id: 'plan-lite',
      name: 'Lite',
      isActive: true,
      basePrice: 23000,
      additionalUserPrice: 1500,
    };

    it('deve lançar NotFoundException se não houver assinatura Asaas', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(null);

      await expect(
        service.changePlan('company-1', 'plan-lite'),
      ).rejects.toThrow(NotFoundException);
      expect(
        mockAsaasGatewayService.updateAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    it('no anual, recusa: o valor calculado aqui é mensal', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        ...currentSubscription,
        cycle: 'YEARLY',
      });

      await expect(
        service.changePlan('company-1', 'plan-lite'),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockAsaasGatewayService.updateAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    it('no anual parcelado, que não tem assinatura no Asaas, também recusa', async () => {
      mockPrismaService.subscription.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'sub-anual' });

      await expect(
        service.changePlan('company-1', 'plan-lite'),
      ).rejects.toThrow('ciclo anual');
    });

    it('deve lançar NotFoundException se o plano não existir', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        currentSubscription,
      );
      mockPrismaService.plan.findUnique.mockResolvedValue(null);

      await expect(service.changePlan('company-1', 'plan-x')).rejects.toThrow(
        NotFoundException,
      );
      expect(
        mockAsaasGatewayService.updateAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    it('deve recusar plano indisponível para contratação', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        currentSubscription,
      );
      mockPrismaService.plan.findUnique.mockResolvedValue({
        ...litePlan,
        isActive: false,
      });

      await expect(
        service.changePlan('company-1', 'plan-lite'),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockAsaasGatewayService.updateAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    it('deve recusar plano sem preço definido', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        currentSubscription,
      );
      mockPrismaService.plan.findUnique.mockResolvedValue({
        ...litePlan,
        basePrice: 0,
      });

      await expect(
        service.changePlan('company-1', 'plan-lite'),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockAsaasGatewayService.updateAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    it('deve recusar troca para o mesmo plano', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue({
        ...currentSubscription,
        planId: 'plan-lite',
      });
      mockPrismaService.plan.findUnique.mockResolvedValue(litePlan);

      await expect(
        service.changePlan('company-1', 'plan-lite'),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockAsaasGatewayService.updateAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    it('deve reiniciar o ciclo quando há cobrança vencida', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        currentSubscription,
      );
      mockPrismaService.plan.findUnique.mockResolvedValue(litePlan);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { id: 'pay_2', status: 'PENDING', dueDate: '2026-07-16' },
        { id: 'pay_1', status: 'OVERDUE', dueDate: '2026-06-16' },
      ]);
      mockPrismaService.subscription.update.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-lite',
      });

      const hoje = new Date().toISOString().split('T')[0];

      await service.changePlan('company-1', 'plan-lite');

      // base 23000 + módulo 7000 + 2 usuários * 1500 = 33000 centavos => R$ 330
      // A cobrança mais antiga vira a fatura de reativação: valor do NOVO
      // plano, vencendo hoje — nada do período bloqueado é cobrado.
      expect(mockAsaasGatewayService.updateAsaasPayment).toHaveBeenCalledWith(
        'pay_1',
        {
          value: 330,
          dueDate: hoje,
          description: 'Assinatura Lite',
        },
      );

      // A cobrança do período não usufruído é descartada
      expect(mockAsaasGatewayService.deleteAsaasPayment).toHaveBeenCalledWith(
        'pay_2',
      );
      expect(mockAsaasGatewayService.deleteAsaasPayment).toHaveBeenCalledTimes(
        1,
      );

      // Assinatura passa a valer o novo plano com o próximo vencimento à frente
      expect(
        mockAsaasGatewayService.updateAsaasSubscription,
      ).toHaveBeenCalledWith(
        'sub_123',
        expect.objectContaining({
          value: 330,
          description: 'Assinatura Lite',
          nextDueDate: expect.any(String),
          updatePendingPayments: false,
        }),
      );

      // Nunca cancela a assinatura (isso órfãozaria as cobranças)
      expect(
        mockAsaasGatewayService.cancelAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    it('não deve remover cobranças se a fatura de reativação falhar', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        currentSubscription,
      );
      mockPrismaService.plan.findUnique.mockResolvedValue(litePlan);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { id: 'pay_1', status: 'OVERDUE', dueDate: '2026-06-16' },
        { id: 'pay_2', status: 'PENDING', dueDate: '2026-07-16' },
      ]);
      mockAsaasGatewayService.updateAsaasPayment.mockRejectedValue(
        new Error('Asaas indisponível'),
      );

      await expect(
        service.changePlan('company-1', 'plan-lite'),
      ).rejects.toThrow('Asaas indisponível');

      // O cliente nunca pode ficar sem nenhuma cobrança pagável
      expect(mockAsaasGatewayService.deleteAsaasPayment).not.toHaveBeenCalled();
    });

    it('changePlanAsAdmin: recusa senha gerencial incorreta', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePlanAsAdmin(
          'company-1',
          'plan-lite',
          'senha-errada',
          'admin-1',
        ),
      ).rejects.toThrow(UnauthorizedException);

      // Não pode chegar a mexer na assinatura sem autorização
      expect(mockPrismaService.subscription.findFirst).not.toHaveBeenCalled();
    });

    it('changePlanAsAdmin: com senha válida delega para changePlan', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        password: 'hashed',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        currentSubscription,
      );
      mockPrismaService.plan.findUnique.mockResolvedValue(litePlan);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue(
        [],
      );
      mockPrismaService.subscription.update.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-lite',
      });

      await service.changePlanAsAdmin(
        'company-1',
        'plan-lite',
        'senha-certa',
        'admin-1',
      );

      expect(
        mockAsaasGatewayService.updateAsaasSubscription,
      ).toHaveBeenCalledWith(
        'sub_123',
        expect.objectContaining({ value: 330, description: 'Assinatura Lite' }),
      );
      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planId: 'plan-lite' }),
        }),
      );
    });

    it('não deve mexer em cobranças quando a assinatura está em dia', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        currentSubscription,
      );
      mockPrismaService.plan.findUnique.mockResolvedValue(litePlan);
      mockAsaasGatewayService.getAsaasSubscriptionPayments.mockResolvedValue([
        { id: 'pay_9', status: 'PENDING', dueDate: '2026-08-16' },
      ]);
      mockPrismaService.subscription.update.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-lite',
      });

      const result = await service.changePlan('company-1', 'plan-lite');

      expect(
        mockAsaasGatewayService.updateAsaasSubscription,
      ).toHaveBeenCalledWith('sub_123', {
        value: 330,
        description: 'Assinatura Lite',
        updatePendingPayments: false,
      });

      // Sem inadimplência não se mexe no ciclo nem nas cobranças emitidas
      expect(mockAsaasGatewayService.updateAsaasPayment).not.toHaveBeenCalled();
      expect(mockAsaasGatewayService.deleteAsaasPayment).not.toHaveBeenCalled();

      expect(mockPrismaService.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: { planId: 'plan-lite', value: 330 },
        }),
      );
      expect(result).toEqual({ id: 'sub-1', planId: 'plan-lite' });
    });
  });

  describe('cancelSubscription', () => {
    it('o anual não se cancela por aqui: cortaria o resto de um ano pago', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-anual',
        companyId: 'company-1',
        status: 'ACTIVE',
        cycle: 'YEARLY',
        billingMode: 'ASAAS_INSTALLMENT',
        asaasSubscriptionId: 'inst_sub-anual',
        plan: { planType: 'START' },
      });
      mockPrismaService.company.findUnique.mockResolvedValue({
        ownerUserId: 'user-1',
      });

      await expect(
        service.cancelSubscription(
          'sub-anual',
          { reason: 'Preço' } as any,
          'company-1',
          'user-1',
        ),
      ).rejects.toThrow('plano anual');
      expect(
        mockAsaasGatewayService.cancelAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    it('só o administrador principal (Usuário nº 1) cancela: outro administrador é recusado', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        companyId: 'company-1',
        status: 'ACTIVE',
        cycle: 'MONTHLY',
        asaasSubscriptionId: 'sub_123',
        plan: { planType: 'START' },
      });
      mockPrismaService.company.findUnique.mockResolvedValue({
        ownerUserId: 'titular',
      });

      await expect(
        service.cancelSubscription(
          'sub-1',
          { reason: 'Preço' } as any,
          'company-1',
          'outro-admin',
        ),
      ).rejects.toMatchObject({ response: { code: 'OWNER_ONLY' } });
      expect(
        mockAsaasGatewayService.cancelAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    const mensal = {
      id: 'sub-1',
      companyId: 'company-1',
      status: 'ACTIVE',
      cycle: 'MONTHLY',
      asaasSubscriptionId: 'sub_123',
      plan: { planType: 'START' },
    };

    it('com mensalidade vencida no Asaas, não cancela (contrato, 7.5 e 8.1)', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(mensal);
      mockPrismaService.company.findUnique.mockResolvedValue({
        ownerUserId: 'user-1',
        blockLevel: 'NONE',
      });
      mockAsaasGatewayService.getChargesOf.mockResolvedValue([
        { status: 'OVERDUE', dueDate: '2026-09-01' },
      ]);

      await expect(
        service.cancelSubscription(
          'sub-1',
          { reason: 'Preço' } as any,
          'company-1',
          'user-1',
        ),
      ).rejects.toMatchObject({ response: { code: 'OPEN_CHARGE' } });
      expect(
        mockAsaasGatewayService.cancelAsaasSubscription,
      ).not.toHaveBeenCalled();
    });

    it('com a conta bloqueada por atraso, não cancela — bloqueio não é cancelamento', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(mensal);
      mockPrismaService.company.findUnique.mockResolvedValue({
        ownerUserId: 'user-1',
        blockLevel: 'PARTIAL',
      });

      await expect(
        service.cancelSubscription(
          'sub-1',
          { reason: 'Preço' } as any,
          'company-1',
          'user-1',
        ),
      ).rejects.toMatchObject({ response: { code: 'OPEN_CHARGE' } });
    });

    it('em dia, cancela e registra a confirmação das exportações', async () => {
      mockPrismaService.subscription.findUnique.mockResolvedValue(mensal);
      mockPrismaService.company.findUnique.mockResolvedValue({
        ownerUserId: 'user-1',
        blockLevel: 'NONE',
      });
      mockAsaasGatewayService.getChargesOf.mockResolvedValue([
        { status: 'RECEIVED', dueDate: '2026-09-01' },
      ]);
      const history = jest.fn();
      mockPrismaService.$transaction.mockImplementation(async (cb) =>
        cb({
          subscription: {
            update: jest.fn().mockResolvedValue({ id: 'sub-1' }),
          },
          subscriptionHistory: { create: history },
        }),
      );

      await service.cancelSubscription(
        'sub-1',
        { reason: 'Preço', exportsConfirmed: true } as any,
        'company-1',
        'user-1',
      );

      expect(
        mockAsaasGatewayService.cancelAsaasSubscription,
      ).toHaveBeenCalledWith('sub_123');
      expect(history).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ exportsConfirmed: true }),
        }),
      });
    });
  });

  describe('Sincronizar com Asaas (superadmin)', () => {
    const activeSubscription = {
      id: 'sub-1',
      companyId: 'company-1',
      status: 'ACTIVE',
      asaasSubscriptionId: 'sub_asaas',
      asaasInstallmentId: null,
      plan: { name: 'Start' },
      payments: [],
    };
    const removedCharge = {
      asaasPaymentId: 'pay_abril',
      dueDate: '2026-04-04',
      value: 147,
      localStatus: 'OVERDUE',
      asaasStatus: 'REMOVED',
      action: 'cancel',
    };
    const paidInAsaas = [
      {
        id: 'pay_setembro',
        status: 'RECEIVED',
        dueDate: '2026-09-04',
        value: 147,
      },
    ];

    it('a verificação oferece sincronizar uma assinatura ativa quando as cobranças divergem', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        activeSubscription,
      );
      mockSubscriptionBlockService.previewCompanyCharges.mockResolvedValue([
        removedCharge,
      ]);
      mockAsaasGatewayService.getChargesOf.mockResolvedValue(paidInAsaas);

      const result: any = await service.checkAsaasStatus('company-1');

      expect(result.hasPendingSync).toBe(true);
      expect(result.divergences).toEqual([removedCharge]);
      expect(result.message).toContain('divergem');
    });

    it('sem divergência, assinatura ativa e paga não oferece sincronizar', async () => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        activeSubscription,
      );
      mockSubscriptionBlockService.previewCompanyCharges.mockResolvedValue([]);
      mockAsaasGatewayService.getChargesOf.mockResolvedValue(paidInAsaas);

      const result: any = await service.checkAsaasStatus('company-1');

      expect(result.hasPendingSync).toBe(false);
      expect(result.message).toContain('Tudo certo');
    });

    it('o botão alinha as cobranças antes de reavaliar ativação e bloqueio', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ name: 'Ana' });
      mockSubscriptionBlockService.syncCompanyCharges.mockResolvedValue({
        created: 0,
        updated: 1,
        canceled: 2,
      });
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        activeSubscription,
      );
      mockPrismaService.company.findUnique.mockResolvedValue({
        blockLevel: 'NONE',
      });

      const result = await service.syncCompanyWithAsaas('company-1', 'admin-1');

      expect(
        mockSubscriptionBlockService.syncCompanyCharges,
      ).toHaveBeenCalledWith('company-1', {
        id: 'admin-1',
        name: 'Ana (Sincronizar com Asaas)',
      });
      // Alinha uma vez só: a reavaliação não repete o alinhamento.
      expect(
        mockSubscriptionBlockService.syncCompanyCharges,
      ).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({
          status: 'already_active',
          charges: { created: 0, updated: 1, canceled: 2 },
        }),
      );
      // A reavaliação lê o banco já alinhado.
      expect(
        mockSubscriptionBlockService.syncCompanyCharges.mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        mockPrismaService.subscription.findFirst.mock.invocationCallOrder[0],
      );
    });

    it('Asaas sem resposta: erro claro e nada é reavaliado', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ name: 'Ana' });
      mockSubscriptionBlockService.syncCompanyCharges.mockRejectedValue(
        new Error('timeout'),
      );

      await expect(
        service.syncCompanyWithAsaas('company-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.subscription.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('Verificar pagamento do cliente (check-status)', () => {
    const activeSubscription = {
      id: 'sub-1',
      companyId: 'company-1',
      status: 'ACTIVE',
      asaasSubscriptionId: 'sub_asaas',
      plan: { name: 'Start' },
      payments: [],
    };

    beforeEach(() => {
      mockPrismaService.subscription.findFirst.mockResolvedValue(
        activeSubscription,
      );
    });

    it('alinha as cobranças ao Asaas antes de reavaliar (a contratação paga sai confirmada)', async () => {
      mockSubscriptionBlockService.syncCompanyCharges.mockResolvedValue({
        created: 0,
        updated: 1,
        canceled: 0,
      });
      mockPrismaService.company.findUnique.mockResolvedValue({
        blockLevel: 'NONE',
      });

      const result: any =
        await service.checkAndSyncSubscriptionStatus('company-1');

      expect(
        mockSubscriptionBlockService.syncCompanyCharges,
      ).toHaveBeenCalledWith('company-1');
      expect(
        mockSubscriptionBlockService.syncCompanyCharges.mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        mockPrismaService.subscription.findFirst.mock.invocationCallOrder[0],
      );
      expect(result.status).toBe('already_active');
    });

    it('quem pagou a vencida é desbloqueado na volta da fatura', async () => {
      mockSubscriptionBlockService.syncCompanyCharges.mockResolvedValue({
        created: 0,
        updated: 1,
        canceled: 0,
      });
      mockPrismaService.company.findUnique.mockResolvedValue({
        blockLevel: 'PARTIAL',
      });
      // Depois de alinhada, a vencida já não está em aberto aqui.
      mockPrismaService.payment.findFirst.mockResolvedValue(null);

      const result: any =
        await service.checkAndSyncSubscriptionStatus('company-1');

      expect(mockSubscriptionBlockService.unblockCompany).toHaveBeenCalledWith(
        'company-1',
      );
      expect(result.status).toBe('unblocked');
    });

    it('Asaas fora do ar: reavalia com o banco, sem erro', async () => {
      mockSubscriptionBlockService.syncCompanyCharges.mockRejectedValue(
        new Error('timeout'),
      );
      mockPrismaService.company.findUnique.mockResolvedValue({
        blockLevel: 'NONE',
      });

      const result: any =
        await service.checkAndSyncSubscriptionStatus('company-1');

      expect(result.status).toBe('already_active');
    });

    it('sem empresa, não consulta o Asaas', async () => {
      const result: any = await service.checkAndSyncSubscriptionStatus('');

      expect(result).toEqual({
        success: false,
        message: 'ID da empresa não informado',
      });
      expect(
        mockSubscriptionBlockService.syncCompanyCharges,
      ).not.toHaveBeenCalled();
    });
  });
});
