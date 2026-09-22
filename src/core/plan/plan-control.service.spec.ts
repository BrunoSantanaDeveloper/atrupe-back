import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PlanControlService } from './plan-control.service';
import { PrismaService } from 'nestjs-prisma';

describe('PlanControlService', () => {
  let service: PlanControlService;

  const mockPrismaService = {
    company: {
      findUnique: jest.fn(),
    },
    employee: {
      count: jest.fn(),
    },
    limit: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanControlService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PlanControlService>(PlanControlService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Helper: mock company with subscription, plan, features, limits
  function mockCompanyWithPlan(overrides: {
    planType?: string;
    planName?: string;
    features?: { key: string }[];
    limits?: { key: string; value: number }[];
    additionalUsers?: number;
    nextDueDate?: Date;
    subscriptionFeatures?: { key: string; isActive: boolean }[];
  }) {
    const {
      planType = 'START',
      planName = 'Start',
      features = [],
      limits = [],
      additionalUsers = 0,
      nextDueDate = new Date(Date.now() + 86400000),
      subscriptionFeatures = [],
    } = overrides;

    mockPrismaService.company.findUnique.mockResolvedValue({
      Subscription: [
        {
          id: 'sub-1',
          additionalUsers,
          nextDueDate,
          plan: {
            id: 'plan-1',
            name: planName,
            planType,
            planFeatures: features.map((f) => ({
              feature: { key: f.key },
            })),
            planLimits: limits.map((l) => ({
              limit: { key: l.key },
              value: l.value,
            })),
          },
          subscriptionFeatures: subscriptionFeatures.map((sf) => ({
            isActive: sf.isActive,
            feature: { key: sf.key },
          })),
        },
      ],
    });
  }

  describe('getCompanyPlanInfo', () => {
    it('should throw BadRequestException when company not found', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue(null);

      await expect(service.getCompanyPlanInfo('invalid-id')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('prefere a assinatura paga quando o trial ainda está ACTIVE', async () => {
      // Durante a virada do trial para o plano pago, as duas ficam ACTIVE por
      // um instante. Pegar a primeira da lista fazia o plano da sessão sair
      // errado — e é do plano da sessão que dependem o middleware e as features.
      mockPrismaService.company.findUnique.mockResolvedValue({
        Subscription: [
          {
            id: 'sub-trial',
            additionalUsers: 0,
            nextDueDate: new Date(),
            plan: {
              id: 'plan-trial',
              name: 'Trial',
              planType: 'TRIAL',
              planFeatures: [],
              planLimits: [],
            },
            subscriptionFeatures: [],
          },
          {
            id: 'sub-paga',
            additionalUsers: 0,
            nextDueDate: new Date(),
            plan: {
              id: 'plan-start',
              name: 'Start',
              planType: 'START',
              planFeatures: [],
              planLimits: [],
            },
            subscriptionFeatures: [],
          },
        ],
      });

      const result = await service.getCompanyPlanInfo('company-1');

      expect(result.planType).toBe('START');
    });

    it('should return null when company has no active subscription', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        Subscription: [],
      });

      const result = await service.getCompanyPlanInfo('company-1');
      expect(result).toBeNull();
    });

    it('should return plan info with merged features (plan + subscription)', async () => {
      mockCompanyWithPlan({
        features: [{ key: 'nfe' }, { key: 'nfse' }],
        subscriptionFeatures: [
          { key: 'nfce', isActive: true },
          { key: 'payroll', isActive: false },
        ],
      });

      const result = await service.getCompanyPlanInfo('company-1');

      expect(result.features.nfe).toBe(true);
      expect(result.features.nfse).toBe(true);
      expect(result.features.nfce).toBe(true);
      expect(result.features.payroll).toBeUndefined(); // inactive
    });

    it('should add additionalUsers to max_users limit', async () => {
      mockCompanyWithPlan({
        limits: [{ key: 'max_users', value: 3 }],
        additionalUsers: 5,
      });

      const result = await service.getCompanyPlanInfo('company-1');

      expect(result.limits.max_users).toBe(8); // 3 + 5
    });

    it('should detect trial as active when TRIAL + future date', async () => {
      mockCompanyWithPlan({
        planType: 'TRIAL',
        nextDueDate: new Date(Date.now() + 86400000 * 3),
      });

      const result = await service.getCompanyPlanInfo('company-1');

      expect(result.isTrialActive).toBe(true);
      expect(result.trialEndsAt).toBeDefined();
    });

    it('should detect trial as expired when TRIAL + past date', async () => {
      mockCompanyWithPlan({
        planType: 'TRIAL',
        nextDueDate: new Date(Date.now() - 86400000),
      });

      const result = await service.getCompanyPlanInfo('company-1');

      expect(result.isTrialActive).toBe(false);
    });
  });

  describe('hasFeature', () => {
    it('should return true when feature exists in plan', async () => {
      mockCompanyWithPlan({ features: [{ key: 'nfe' }] });

      const result = await service.hasFeature('company-1', 'nfe');
      expect(result).toBe(true);
    });

    it('should return false when feature does not exist', async () => {
      mockCompanyWithPlan({ features: [] });

      const result = await service.hasFeature('company-1', 'nfe');
      expect(result).toBe(false);
    });
  });

  describe('checkLimit', () => {
    it('should return true when usage is below limit', async () => {
      mockCompanyWithPlan({ limits: [{ key: 'max_users', value: 5 }] });

      const result = await service.checkLimit('company-1', 'max_users', 3);
      expect(result).toBe(true);
    });

    it('should return false when usage equals limit', async () => {
      mockCompanyWithPlan({ limits: [{ key: 'max_users', value: 5 }] });

      const result = await service.checkLimit('company-1', 'max_users', 5);
      expect(result).toBe(false);
    });

    it('should return true when limit is -1 (unlimited)', async () => {
      mockCompanyWithPlan({ limits: [{ key: 'max_users', value: -1 }] });

      const result = await service.checkLimit('company-1', 'max_users', 999);
      expect(result).toBe(true);
    });

    it('should return true when limit key does not exist (permissive)', async () => {
      mockCompanyWithPlan({ limits: [] });

      const result = await service.checkLimit('company-1', 'unknown_limit', 10);
      expect(result).toBe(true);
    });
  });

  describe('enforceLimit', () => {
    it('should not throw when within limit', async () => {
      mockCompanyWithPlan({ limits: [{ key: 'max_users', value: 10 }] });

      await expect(
        service.enforceLimit('company-1', 'max_users', 5),
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when limit exceeded', async () => {
      mockCompanyWithPlan({
        planName: 'Start',
        limits: [{ key: 'max_users', value: 3 }],
      });
      mockPrismaService.limit.findUnique.mockResolvedValue({
        name: 'usuários',
        description: 'Máximo de usuários',
        unit: 'users',
      });

      await expect(
        service.enforceLimit('company-1', 'max_users', 5),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('enforceFeature', () => {
    it('should not throw when feature is available', async () => {
      mockCompanyWithPlan({ features: [{ key: 'nfe' }] });

      await expect(
        service.enforceFeature('company-1', 'nfe'),
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when feature is not available', async () => {
      mockCompanyWithPlan({ features: [] });

      await expect(service.enforceFeature('company-1', 'nfe')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('isTrialExpired', () => {
    it('should return false for non-TRIAL plan', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        Subscription: [
          {
            nextDueDate: new Date(Date.now() - 86400000),
            plan: { planType: 'START' },
          },
        ],
      });

      const result = await service.isTrialExpired('company-1');
      expect(result).toBe(false);
    });

    it('should return true when TRIAL plan with past nextDueDate', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        Subscription: [
          {
            nextDueDate: new Date(Date.now() - 86400000),
            plan: { planType: 'TRIAL' },
          },
        ],
      });

      const result = await service.isTrialExpired('company-1');
      expect(result).toBe(true);
    });

    it('should return false when TRIAL plan with future nextDueDate', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        Subscription: [
          {
            nextDueDate: new Date(Date.now() + 86400000 * 3),
            plan: { planType: 'TRIAL' },
          },
        ],
      });

      const result = await service.isTrialExpired('company-1');
      expect(result).toBe(false);
    });

    it('should return false when company has no subscription', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        Subscription: [],
      });

      const result = await service.isTrialExpired('company-1');
      expect(result).toBe(false);
    });
  });

  describe('getCurrentUserCount', () => {
    it('should return count of active employees', async () => {
      mockPrismaService.employee.count.mockResolvedValue(5);

      const result = await service.getCurrentUserCount('company-1');

      expect(result).toBe(5);
      expect(mockPrismaService.employee.count).toHaveBeenCalledWith({
        where: { companyId: 'company-1', isActive: true },
      });
    });
  });
});
