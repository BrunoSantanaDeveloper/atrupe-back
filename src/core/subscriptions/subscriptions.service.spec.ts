import { Test, TestingModule } from '@nestjs/testing';
import {
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from 'src/config/prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { AsaasGatewayService } from './asaas-gateway.service';
import { CouponsService } from '../coupons/coupons.service';

// Mock argon2 globally
jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(),
}));

import * as argon2 from 'argon2';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  const mockPrismaService = {
    user: { findFirst: jest.fn() },
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
    payment: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockCustomersService = {
    createCustomer: jest.fn(),
    findCustomerByEmail: jest.fn(),
  };

  const mockAsaasGatewayService = {
    cancelAsaasSubscription: jest.fn(),
    updateAsaasSubscription: jest.fn(),
    getAsaasSubscriptionPayments: jest.fn(),
    updateAsaasPayment: jest.fn(),
    deleteAsaasPayment: jest.fn(),
  };

  const mockCouponsService = {
    validateCoupon: jest.fn(),
    calculateDiscount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CustomersService, useValue: mockCustomersService },
        { provide: AsaasGatewayService, useValue: mockAsaasGatewayService },
        { provide: CouponsService, useValue: mockCouponsService },
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
});
