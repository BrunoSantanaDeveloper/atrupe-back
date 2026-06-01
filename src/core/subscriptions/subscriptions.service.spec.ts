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
});
