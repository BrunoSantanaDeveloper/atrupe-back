import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from 'nestjs-prisma';
import { CacheService } from 'src/svc/cache/cache.service';
import { PlugService } from 'src/svc/plug/plug.service';
import { CompanyService } from '../company/company.service';
import { MailerService } from '@nestjs-modules/mailer';
import { EmployeeHistoryService } from '../employee/history/history.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';

describe('UserService', () => {
  let service: UserService;
  let prisma: any;
  let cache: any;
  let plug: any;
  let mailerService: any;

  const mockPrismaService = {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    mailVerification: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    employee: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: CacheService,
          useValue: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
        },
        {
          provide: PlugService,
          useValue: { people: jest.fn() },
        },
        {
          provide: CompanyService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
          },
        },
        {
          provide: MailerService,
          useValue: { sendMail: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: EmployeeHistoryService,
          useValue: { create: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prisma = module.get(PrismaService);
    cache = module.get(CacheService);
    plug = module.get(PlugService);
    mailerService = module.get(MailerService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── sendEmailValidation ─────────────────────────────────────
  describe('sendEmailValidation', () => {
    it('should return canResendIn if valid token already exists', async () => {
      const futureDate = new Date(Date.now() + 60_000);
      prisma.mailVerification.findFirst.mockResolvedValue({
        email: 'test@test.com',
        token: '1234',
        expiresAt: futureDate,
      });

      const result = await service.sendEmailValidation('test@test.com');

      expect(result).toHaveProperty('canResendIn');
      expect(result.canResendIn).toBeGreaterThan(0);
      expect(prisma.mailVerification.upsert).not.toHaveBeenCalled();
    });

    it('should generate token and send email when no existing token', async () => {
      prisma.mailVerification.findFirst.mockResolvedValue(null);
      prisma.mailVerification.upsert.mockResolvedValue({});

      const result = await service.sendEmailValidation(
        'new@test.com',
        'John',
        'Acme',
        '11999999999',
      );

      expect(result.message).toBe('Email de validação enviado com sucesso.');
      expect(prisma.mailVerification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'new@test.com' },
          create: expect.objectContaining({
            email: 'new@test.com',
            name: 'John',
            companyName: 'Acme',
            phone: '11999999999',
          }),
        }),
      );
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'new@test.com',
          template: 'email-validation',
        }),
      );
    });

    it('should not throw when email sending fails', async () => {
      prisma.mailVerification.findFirst.mockResolvedValue(null);
      prisma.mailVerification.upsert.mockResolvedValue({});
      mailerService.sendMail.mockRejectedValue(new Error('SMTP down'));

      const result = await service.sendEmailValidation('fail@test.com');

      expect(result.message).toBe('Email de validação enviado com sucesso.');
    });
  });

  // ─── verifyEmail ─────────────────────────────────────────────
  describe('verifyEmail', () => {
    it('should verify email with valid token', async () => {
      prisma.mailVerification.findFirst.mockResolvedValue({
        email: 'test@test.com',
        token: '1234',
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.mailVerification.update.mockResolvedValue({});

      const result = await service.verifyEmail({
        email: 'test@test.com',
        token: '1234',
      });

      expect(result.message).toBe('Email verificado com sucesso.');
      expect(prisma.mailVerification.update).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
        data: { verified: true, token: null, expiresAt: null },
      });
    });

    it('should throw BadRequestException for invalid/expired token', async () => {
      prisma.mailVerification.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ email: 'test@test.com', token: '9999' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── forgotPassword ──────────────────────────────────────────
  describe('forgotPassword', () => {
    it('should send reset email for existing user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        name: 'User',
      });
      prisma.user.update.mockResolvedValue({});

      await service.forgotPassword({ email: 'user@test.com' } as any);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            resetPasswordToken: expect.any(String),
            resetPasswordExpires: expect.any(Date),
          }),
        }),
      );
      expect(mailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@test.com',
          template: 'reset-password',
        }),
      );
    });

    it('should silently return for non-existent email (no leak)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'ghost@test.com',
      } as any);

      expect(result).toBeUndefined();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mailerService.sendMail).not.toHaveBeenCalled();
    });

    it('should not throw when mailer fails', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@test.com',
        name: 'User',
      });
      prisma.user.update.mockResolvedValue({});
      mailerService.sendMail.mockRejectedValue(new Error('SMTP error'));

      await expect(
        service.forgotPassword({ email: 'user@test.com' } as any),
      ).resolves.not.toThrow();
    });
  });

  // ─── resetPassword ───────────────────────────────────────────
  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        resetPasswordToken: 'valid-token',
        resetPasswordExpires: new Date(Date.now() + 3_600_000),
      });
      prisma.user.update.mockResolvedValue({});

      await service.resetPassword({
        token: 'valid-token',
        password: 'newSecurePassword123',
      } as any);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            password: expect.any(String),
            resetPasswordToken: null,
            resetPasswordExpires: null,
          }),
        }),
      );
    });

    it('should hash the new password with argon2', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        resetPasswordToken: 'valid-token',
        resetPasswordExpires: new Date(Date.now() + 3_600_000),
      });
      prisma.user.update.mockResolvedValue({});

      await service.resetPassword({
        token: 'valid-token',
        password: 'myNewPassword',
      } as any);

      const savedPassword = prisma.user.update.mock.calls[0][0].data.password;
      const isArgon2 = await argon2.verify(savedPassword, 'myNewPassword');
      expect(isArgon2).toBe(true);
    });

    it('should throw UnauthorizedException for invalid token', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: 'expired-token',
          password: 'newPassword',
        } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── findByEmail ─────────────────────────────────────────────
  describe('findByEmail', () => {
    it('should return user with relations', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@test.com',
        employee: [{ id: 'emp-1', company: { id: 'c-1' } }],
        userRole: [],
        customer: null,
      };
      prisma.user.findFirst.mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@test.com');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'test@test.com', isActive: true },
          include: expect.objectContaining({
            employee: expect.any(Object),
            userRole: expect.any(Object),
          }),
        }),
      );
    });

    it('should return null for non-existent email', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.findByEmail('unknown@test.com');

      expect(result).toBeNull();
    });
  });

  // ─── findAll ─────────────────────────────────────────────────
  describe('findAll', () => {
    it('should return list of users with id, name, email', async () => {
      const users = [
        { id: '1', name: 'A', email: 'a@t.com' },
        { id: '2', name: 'B', email: 'b@t.com' },
      ];
      prisma.user.findMany.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toEqual(users);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        select: { id: true, name: true, email: true },
      });
    });
  });

  // ─── findOne ─────────────────────────────────────────────────
  describe('findOne', () => {
    it('should return user response DTO and cache it', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        name: 'User Name',
        email: 'user@test.com',
        avatar: 'avatar-url',
        employee: [
          {
            name: 'Employee Name',
            company: { id: 'c-1', name: 'Company' },
            role: {
              name: 'Admin',
              isAdmin: true,
              permissions: ['client:create'],
            },
          },
        ],
        userRole: [],
      });

      const result = await service.findOne('user-1');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'user-1',
          name: 'Employee Name',
          email: 'user@test.com',
          policies: ['client:create'],
        }),
      );
      expect(cache.set).toHaveBeenCalledWith('user:user-1', result);
    });

    it('should return null when user not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.findOne('nonexistent');

      expect(result).toBeNull();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('should fallback to user.name when no employee', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        name: 'User Name',
        email: 'user@test.com',
        avatar: null,
        employee: [],
        userRole: [],
      });

      const result = await service.findOne('user-1');

      expect(result.name).toBe('User Name');
      expect(result.employee).toBeNull();
    });
  });

  // ─── update ──────────────────────────────────────────────────
  describe('update', () => {
    it('should update user and hash password if provided', async () => {
      const updatedUser = {
        id: 'user-1',
        name: 'Updated',
        email: 'updated@test.com',
        password: 'hashed',
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.update('user-1', {
        name: 'Updated',
        password: 'newPass123',
      } as any);

      expect(result.password).toBeUndefined();
    });

    it('should activate employee when isActive=true', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.user.update.mockResolvedValue({
        id: 'user-1',
        name: 'User',
      });
      prisma.user.findUnique.mockResolvedValue({
        employee: [{ id: 'emp-1' }],
      });
      prisma.employee.update.mockResolvedValue({});

      await service.update('user-1', { isActive: true } as any);

      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { isActive: true },
      });
    });
  });

  // ─── check ───────────────────────────────────────────────────
  describe('check', () => {
    it('should delegate to plug.people', async () => {
      plug.people.mockResolvedValue({ name: 'John', cpf: '12345678900' });

      const result = await service.check('12345678900');

      expect(plug.people).toHaveBeenCalledWith('12345678900');
      expect(result).toEqual({ name: 'John', cpf: '12345678900' });
    });
  });
});
