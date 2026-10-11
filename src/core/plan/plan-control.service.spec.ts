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
    feature: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    plan: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  /** Planos globais (fora o Trial) com as chaves que cada um inclui. */
  const globalPlan = (
    planType: string,
    name: string,
    isActive: boolean,
    keys: string[],
  ) => ({
    planType,
    name,
    isActive,
    planFeatures: keys.map((key) => ({ feature: { key } })),
  });

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

    it('só conta o que o plano inclui hoje e as concessões dentro da validade', async () => {
      mockCompanyWithPlan({ features: [] });

      await service.getCompanyPlanInfo('company-1');

      const query = mockPrismaService.company.findUnique.mock.calls[0][0];
      const sub = query.select.Subscription.select;
      expect(sub.plan.select.planFeatures.where).toEqual({
        isActive: true,
        feature: { isActive: true },
      });
      expect(sub.plan.select.planLimits.where).toEqual({ isActive: true });
      expect(sub.subscriptionFeatures.where).toEqual(
        expect.objectContaining({
          isActive: true,
          feature: { isActive: true },
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }),
      );
    });

    it('limite ilimitado (-1) continua ilimitado com usuários adicionais', async () => {
      mockCompanyWithPlan({
        limits: [{ key: 'max_users', value: -1 }],
        additionalUsers: 4,
      });

      const result = await service.getCompanyPlanInfo('company-1');
      expect(result.limits.max_users).toBe(-1);
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

    it('aceita o uso igual ao limite: o valor é o total depois da ação', async () => {
      // Com limite 5, criar o 5º usuário (uso depois = 5) é permitido. Antes o
      // LimitGuard somava 1 e a conta usava "<": o 5º era recusado.
      mockCompanyWithPlan({ limits: [{ key: 'max_users', value: 5 }] });

      const result = await service.checkLimit('company-1', 'max_users', 5);
      expect(result).toBe(true);
    });

    it('recusa o uso acima do limite', async () => {
      mockCompanyWithPlan({ limits: [{ key: 'max_users', value: 5 }] });

      const result = await service.checkLimit('company-1', 'max_users', 6);
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

    it('o 403 diz a partir de qual plano o recurso está disponível', async () => {
      mockCompanyWithPlan({ planName: 'Start', features: [] });
      mockPrismaService.feature.findMany.mockResolvedValue([
        {
          key: 'cost_base',
          name: 'Base de custos',
          category: 'costs',
          price: 0,
        },
      ]);
      mockPrismaService.plan.findMany.mockResolvedValue([
        globalPlan('START', 'Start', true, []),
        globalPlan('LITE', 'Lite', true, ['cash_control']),
        globalPlan('PRO', 'Pro', false, ['cash_control', 'cost_base']),
        globalPlan('ELITE', 'Elite', false, ['cash_control', 'cost_base']),
      ]);

      const error = await service
        .enforceFeature('company-1', 'cost_base')
        .catch((e) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toEqual({
        code: 'FEATURE_NOT_AVAILABLE',
        feature: 'cost_base',
        planType: 'START',
        availableFrom: { planType: 'PRO', name: 'Pro', isActive: false },
        module: false,
        message:
          'O recurso "Base de custos" está disponível a partir do plano Pro.',
      });
    });

    it('a disponibilidade só olha planos globais fora o Trial, com plano e catálogo ativos', async () => {
      mockCompanyWithPlan({ features: [] });

      await service.enforceFeature('company-1', 'cost_base').catch((e) => e);

      const query = mockPrismaService.plan.findMany.mock.calls[0][0];
      expect(query.where).toEqual({
        companyId: null,
        planType: { not: 'TRIAL' },
      });
      expect(query.orderBy).toEqual({ order: 'asc' });
      expect(query.select.planFeatures.where).toEqual({
        isActive: true,
        feature: { isActive: true, key: { in: ['cost_base'] } },
      });
    });

    it('módulo pago: o 403 diz que é contratado à parte', async () => {
      mockCompanyWithPlan({ planName: 'Lite', planType: 'LITE' });
      mockPrismaService.feature.findMany.mockResolvedValue([
        {
          key: 'nota_fiscal',
          name: 'Nota Fiscal',
          category: 'fiscal',
          price: 7000,
        },
      ]);
      mockPrismaService.plan.findMany.mockResolvedValue([
        globalPlan('LITE', 'Lite', true, ['cash_control']),
      ]);

      const error = await service
        .enforceFeature('company-1', 'nota_fiscal')
        .catch((e) => e);

      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          availableFrom: null,
          module: true,
          message: 'O recurso "Nota Fiscal" é um módulo contratado à parte.',
        }),
      );
    });

    it('recurso que nenhum plano tem: o 403 diz que não está disponível', async () => {
      mockCompanyWithPlan({ planName: 'Start' });
      mockPrismaService.feature.findMany.mockResolvedValue([
        {
          key: 'can_bill_on_delivery_and_checkout',
          name: 'Faturar na entrega e na frente de caixa',
          category: 'quotations',
          price: 0,
        },
      ]);
      mockPrismaService.plan.findMany.mockResolvedValue([
        globalPlan('START', 'Start', true, []),
        globalPlan('LITE', 'Lite', true, ['cash_control']),
      ]);

      const error = await service
        .enforceFeature('company-1', 'can_bill_on_delivery_and_checkout')
        .catch((e) => e);

      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          availableFrom: null,
          module: false,
          message:
            'O recurso "Faturar na entrega e na frente de caixa" não está disponível nos planos atuais.',
        }),
      );
    });

    it('com uma lista, vale o plano mais baixo que tem alguma das chaves', async () => {
      mockCompanyWithPlan({ planName: 'Start' });
      mockPrismaService.feature.findMany.mockResolvedValue([
        { key: 'a', name: 'A', category: 'costs', price: 0 },
        { key: 'b', name: 'B', category: 'costs', price: 0 },
      ]);
      mockPrismaService.plan.findMany.mockResolvedValue([
        globalPlan('LITE', 'Lite', true, []),
        globalPlan('PRO', 'Pro', false, ['b']),
        globalPlan('ELITE', 'Elite', false, ['a', 'b']),
      ]);

      const error = await service
        .enforceFeature('company-1', ['a', 'b'])
        .catch((e) => e);

      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          feature: ['a', 'b'],
          availableFrom: { planType: 'PRO', name: 'Pro', isActive: false },
          message:
            'O recurso "A" ou "B" está disponível a partir do plano Pro.',
        }),
      );
    });

    it('com uma lista, basta um dos recursos', async () => {
      mockCompanyWithPlan({ features: [{ key: 'b' }] });

      await expect(
        service.enforceFeature('company-1', ['a', 'b']),
      ).resolves.not.toThrow();
      await expect(service.hasFeature('company-1', ['a', 'c'])).resolves.toBe(
        false,
      );
    });

    it('sem assinatura ativa, nenhum recurso vale', async () => {
      mockPrismaService.company.findUnique.mockResolvedValue({
        Subscription: [],
      });
      mockPrismaService.feature.findMany.mockResolvedValue([
        {
          key: 'cash_control',
          name: 'Controle de Caixa',
          category: 'financial',
          price: 0,
        },
      ]);

      const error = await service
        .enforceFeature('company-1', 'cash_control')
        .catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse().planType).toBeNull();
      expect(error.getResponse().message).toBe(
        'O recurso "Controle de Caixa" depende de uma assinatura ativa.',
      );
    });
  });

  describe('getFeatureAvailability', () => {
    it('sem chaves, lista o catálogo ativo com o plano de onde cada uma fica disponível', async () => {
      mockPrismaService.feature.findMany.mockResolvedValue([
        {
          key: 'cash_control',
          name: 'Controle de Caixa',
          category: 'financial',
          price: 0,
        },
        {
          key: 'nota_fiscal',
          name: 'Nota Fiscal',
          category: 'fiscal',
          price: 7000,
        },
      ]);
      mockPrismaService.plan.findMany.mockResolvedValue([
        globalPlan('START', 'Start', true, []),
        globalPlan('LITE', 'Lite', true, ['cash_control']),
        globalPlan('PRO', 'Pro', false, ['cash_control']),
      ]);

      const result = await service.getFeatureAvailability();

      expect(result).toEqual([
        {
          key: 'cash_control',
          name: 'Controle de Caixa',
          category: 'financial',
          availableFrom: { planType: 'LITE', name: 'Lite', isActive: true },
          module: false,
        },
        {
          key: 'nota_fiscal',
          name: 'Nota Fiscal',
          category: 'fiscal',
          availableFrom: null,
          module: true,
        },
      ]);
      expect(mockPrismaService.feature.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
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
    it('conta colaboradores ativos com acesso (usuário ativo)', async () => {
      mockPrismaService.employee.count.mockResolvedValue(5);

      const result = await service.getCurrentUserCount('company-1');

      expect(result).toBe(5);
      expect(mockPrismaService.employee.count).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          isActive: true,
          userId: { not: null },
          user: { isActive: true },
        },
      });
    });

    it('enforceUserLimit soma a pessoa nova ao uso atual', async () => {
      mockPrismaService.employee.count.mockResolvedValue(3);
      mockCompanyWithPlan({
        planName: 'Start',
        limits: [{ key: 'max_users', value: 3 }],
      });
      mockPrismaService.limit.findUnique.mockResolvedValue({
        name: 'Máximo de Usuários',
      });

      const error = await service.enforceUserLimit('company-1').catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse().code).toBe('PLAN_LIMIT_REACHED');

      mockPrismaService.employee.count.mockResolvedValue(2);
      await expect(
        service.enforceUserLimit('company-1'),
      ).resolves.toBeUndefined();
    });
  });
});
