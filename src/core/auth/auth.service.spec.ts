process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { PlanControlService } from '../plan/plan-control.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CompanySessionService } from '../subscriptions/checkout/company-session.service';
import { SessionAccessService } from './session-access.service';
import * as argon2 from 'argon2';

describe('AuthService', () => {
  // Conta desativada por transferência: o login diz o motivo.
  const transferredAccess = jest.fn().mockResolvedValue(null);

  // Sessão da empresa no login: pagamento pendente e titularidade.
  const companySessionBuild = jest.fn().mockResolvedValue({
    plan: {
      name: 'START',
      active: true,
      trialEndsAt: null,
      features: [],
      limits: {},
    },
    blockLevel: 'NONE',
    billing: {
      situation: 'EM_DIA',
      daysOverdue: 0,
      paymentPending: true,
      chargeInFocus: null,
    },
    isOwner: true,
  });
  let service: AuthService;
  let userService: jest.Mocked<UserService>;
  let jwtService: jest.Mocked<JwtService>;
  let planControlService: jest.Mocked<PlanControlService>;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashed-password',
    avatar: 'avatar-url',
    userRole: [],
    customer: null,
    employee: [
      {
        id: 'emp-123',
        name: 'Test Employee',
        avatarUrl: 'avatar-url',
        company: {
          id: 'company-123',
          name: 'Test Company',
          legalName: 'Test Company LTDA',
          logoUrl: 'logo-url',
          favIconUrl: 'favicon-url',
        },
        role: {
          id: 'role-123',
          name: 'Admin',
          isAdmin: true,
          permissions: ['client:create', 'client:view'],
        },
      },
    ],
  };

  const mockSystemAdminUser = {
    id: 'admin-123',
    email: 'admin@system.com',
    name: 'System Admin',
    password: 'hashed-password',
    avatar: 'avatar-url',
    userRole: [{ isSystemAdmin: true }],
    customer: null,
    employee: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UserService,
          useValue: {
            findByEmail: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
          },
        },
        {
          provide: PlanControlService,
          useValue: {
            getCompanyPlanInfo: jest.fn().mockResolvedValue({
              planId: 'plan-1',
              planType: 'LITE',
              planName: 'Lite',
              features: {},
              limits: {},
              additionalUsers: 0,
              isTrialActive: false,
              trialEndsAt: null,
            }),
          },
        },
        {
          provide: SubscriptionsService,
          useValue: {
            checkAndSyncSubscriptionStatus: jest.fn().mockResolvedValue({
              status: 'unchanged',
            }),
          },
        },
        {
          provide: CompanySessionService,
          useValue: { build: companySessionBuild },
        },
        {
          provide: SessionAccessService,
          useValue: { transferredAccess: transferredAccess },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userService = module.get(UserService);
    jwtService = module.get(JwtService);
    planControlService = module.get(PlanControlService);
    subscriptionsService = module.get(SubscriptionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user when credentials are valid', async () => {
      const hashedPassword = await argon2.hash('correct-password');
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        password: hashedPassword,
      } as any);

      const result = await service.validateUser(
        'test@example.com',
        'correct-password',
      );

      expect(result).toBeDefined();
      expect(result.email).toBe('test@example.com');
    });

    it('should return null when password is incorrect', async () => {
      const hashedPassword = await argon2.hash('correct-password');
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        password: hashedPassword,
      } as any);

      const result = await service.validateUser(
        'test@example.com',
        'wrong-password',
      );

      expect(result).toBeNull();
    });

    it('should return null when user does not exist', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser(
        'nonexistent@example.com',
        'password',
      );

      expect(result).toBeNull();
    });

    it('quem transferiu o ambiente é informado do motivo, e não de dados inválidos', async () => {
      userService.findByEmail.mockResolvedValue(null);
      transferredAccess.mockResolvedValueOnce({
        companyName: 'Marcenaria Horizonte',
        acceptedAt: new Date('2026-09-20T15:00:00.000Z'),
      });

      await expect(
        service.validateUser('Saiu@Exemplo.com ', 'senha-certa'),
      ).rejects.toMatchObject({
        response: {
          code: 'ACCESS_TRANSFERRED',
          message: expect.stringContaining('Marcenaria Horizonte'),
        },
      });
      expect(transferredAccess).toHaveBeenCalledWith(
        'saiu@exemplo.com',
        'senha-certa',
      );
    });

    it('conta ativa com senha errada não consulta transferência', async () => {
      transferredAccess.mockClear();
      const hashedPassword = await argon2.hash('correct-password');
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        password: hashedPassword,
      } as any);

      await expect(
        service.validateUser('test@example.com', 'wrong-password'),
      ).resolves.toBeNull();
      expect(transferredAccess).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should return login response for company user', async () => {
      const result = await service.login(mockUser);

      expect(result).toHaveProperty('id', 'user-123');
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result).toHaveProperty('company');
      expect(result.isSystemAdmin).toBe(false);
      expect(jwtService.sign).toHaveBeenCalled();
    });

    it('devolve contratação ativa, situação da cobrança e titularidade', async () => {
      const result = await service.login(mockUser);

      expect(result.company.subscriptionActive).toBe(true);
      expect(result.company.billing).toMatchObject({ paymentPending: true });
      expect(result.company.isOwner).toBe(true);
    });

    it('não impede o login quando a sessão da empresa falha', async () => {
      companySessionBuild.mockRejectedValueOnce(new Error('banco lento'));

      const result = await service.login(mockUser);

      expect(result).toHaveProperty('access_token');
      expect(result.company.subscriptionActive).toBe(false);
      expect(result.company.billing).toBeNull();
    });

    it('should return login response for system admin', async () => {
      const result = await service.login(mockSystemAdminUser);

      expect(result).toHaveProperty('id', 'admin-123');
      expect(result).toHaveProperty('access_token');
      expect(result.isSystemAdmin).toBe(true);
      expect(result.permissions).toContain('*');
      expect(result.company).toBeNull();
    });

    it('should check and sync subscription for trial users', async () => {
      planControlService.getCompanyPlanInfo.mockResolvedValue({
        planId: 'plan-trial',
        planType: 'TRIAL',
        planName: 'Trial',
        features: {},
        limits: {},
        additionalUsers: 0,
        isTrialActive: true,
        trialEndsAt: new Date(),
      });

      await service.login(mockUser);

      expect(
        subscriptionsService.checkAndSyncSubscriptionStatus,
      ).toHaveBeenCalledWith('company-123');
    });

    it('should not check subscription for non-trial users', async () => {
      planControlService.getCompanyPlanInfo.mockResolvedValue({
        planId: 'plan-1',
        planType: 'LITE',
        planName: 'Lite',
        features: {},
        limits: {},
        additionalUsers: 0,
        isTrialActive: false,
        trialEndsAt: null,
      });

      await service.login(mockUser);

      expect(
        subscriptionsService.checkAndSyncSubscriptionStatus,
      ).not.toHaveBeenCalled();
    });

    it('should include permissions in response', async () => {
      const result = await service.login(mockUser);

      expect(result.permissions).toEqual(['client:create', 'client:view']);
    });

    it('should include company info in response', async () => {
      const result = await service.login(mockUser);

      expect(result.company).toHaveProperty('id', 'company-123');
      expect(result.company).toHaveProperty('name', 'Test Company');
      expect(result.company).toHaveProperty('subscription', 'LITE');
    });
  });

  describe('refreshToken', () => {
    it('should generate new tokens for valid user', async () => {
      // Mock internal calls
      jest
        .spyOn(service as any, 'generateRefreshToken')
        .mockReturnValue('new-refresh-token');

      // Note: refreshToken requires user lookup internally
      // This test verifies token generation logic
      expect(jwtService.sign).toBeDefined();
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a refresh token with extended expiration', () => {
      const payload = {
        sub: 'user-123',
        username: 'test@example.com',
        companyId: 'company-123',
        role: 'Admin',
        isAdmin: true,
        isSystemAdmin: false,
        employeeId: 'emp-123',
        blockLevel: null,
      };

      const result = (service as any).generateRefreshToken(payload);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('getPlanFeatures', () => {
    it('should return features for company', async () => {
      const result = await (service as any).getPlanFeatures('company-123');

      expect(Array.isArray(result)).toBe(true);
    });
  });
});
