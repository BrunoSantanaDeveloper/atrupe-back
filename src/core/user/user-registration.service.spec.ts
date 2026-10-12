import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserRegistrationService } from './user-registration.service';
import { PrismaService } from 'nestjs-prisma';
import { CacheService } from 'src/svc/cache/cache.service';
import { PlugService } from 'src/svc/plug/plug.service';
import { CompanyService } from '../company/company.service';
import { MailerService } from '@nestjs-modules/mailer';
import { EmployeeHistoryService } from '../employee/history/history.service';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de fábrica
// ─────────────────────────────────────────────────────────────────────────────

const makeVerification = (overrides = {}) => ({
  id: 'verif-1',
  email: 'usuario@empresa.com',
  token: '1234',
  verified: false,
  name: 'João',
  companyName: 'Empresa',
  phone: '11999999999',
  expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min no futuro
  ...overrides,
});

const makeCreateUserDto = (overrides = {}) => ({
  email: 'usuario@empresa.com',
  name: 'João Silva',
  company: 'Empresa Ltda',
  mobile: '11999999999',
  password: 'Senha@123',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// Mocks dos serviços externos
// ─────────────────────────────────────────────────────────────────────────────

const mockPrisma = {
  mailVerification: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  customer: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  subscription: {
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  plan: {
    findFirst: jest.fn(),
  },
  company: {
    delete: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockMailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
const mockCompanyService = {
  createMainCompany: jest.fn(),
  createFirstAccess: jest.fn(),
};
const mockCache = {};
const mockPlug = {};
const mockEmployeeHistory = { createEmployeeHistory: jest.fn() };

// ─────────────────────────────────────────────────────────────────────────────
// Suite principal
// ─────────────────────────────────────────────────────────────────────────────

describe('UserRegistrationService', () => {
  let service: UserRegistrationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRegistrationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
        { provide: PlugService, useValue: mockPlug },
        { provide: CompanyService, useValue: mockCompanyService },
        { provide: MailerService, useValue: mockMailer },
        { provide: EmployeeHistoryService, useValue: mockEmployeeHistory },
      ],
    }).compile();

    service = module.get<UserRegistrationService>(UserRegistrationService);

    // Limpa todos os mocks antes de cada teste
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // sendEmailValidation
  // ───────────────────────────────────────────────────────────────────────────

  describe('sendEmailValidation', () => {
    it('deve retornar canResendIn se já existe token ativo para o email', async () => {
      const existing = makeVerification();
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(existing);

      const result = await service.sendEmailValidation('usuario@empresa.com');

      expect(result).toHaveProperty('canResendIn');
      expect(result.message).toBe('Email já possui um token de validação.');
      // Não deve chamar upsert nem enviar email
      expect(mockPrisma.mailVerification.upsert).not.toHaveBeenCalled();
      expect(mockMailer.sendMail).not.toHaveBeenCalled();
    });

    it('deve normalizar o email para lowercase antes de buscar', async () => {
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(null);
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(null); // para unicidade token
      mockPrisma.mailVerification.upsert.mockResolvedValueOnce({});

      await service.sendEmailValidation('USUARIO@EMPRESA.COM');

      expect(mockPrisma.mailVerification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ email: 'usuario@empresa.com' }),
        }),
      );
    });

    it('deve salvar o token e enviar o email quando não há token ativo', async () => {
      // Primeira chamada: sem token existente; segunda (loop unicidade): sem colisão
      mockPrisma.mailVerification.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.mailVerification.upsert.mockResolvedValueOnce({});

      const result = await service.sendEmailValidation(
        'usuario@empresa.com',
        'João',
        'Empresa',
        '11999',
      );

      expect(mockPrisma.mailVerification.upsert).toHaveBeenCalledTimes(1);
      expect(mockMailer.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'usuario@empresa.com',
          template: 'email-validation',
        }),
      );
      expect(result.message).toBe('Email de validação enviado com sucesso.');
    });

    it('deve expor devToken em ambiente não-produção', async () => {
      process.env.APP_ENV = 'development';
      mockPrisma.mailVerification.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.mailVerification.upsert.mockResolvedValueOnce({});

      const result = await service.sendEmailValidation('usuario@empresa.com');

      expect(result).toHaveProperty('devToken');
      delete process.env.APP_ENV;
    });

    it('NÃO deve expor devToken em ambiente de produção', async () => {
      const originalEnv = process.env.APP_ENV;
      process.env.APP_ENV = 'production';
      mockPrisma.mailVerification.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.mailVerification.upsert.mockResolvedValueOnce({});

      const result = await service.sendEmailValidation('usuario@empresa.com');

      expect(result).not.toHaveProperty('devToken');
      process.env.APP_ENV = originalEnv;
    });

    it('NÃO expõe o devToken em produção nem para e-mail @atrupe-test.com', async () => {
      const originalEnv = process.env.APP_ENV;
      process.env.APP_ENV = 'production';
      mockPrisma.mailVerification.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.mailVerification.upsert.mockResolvedValueOnce({});

      const result = await service.sendEmailValidation(
        'qualquer@atrupe-test.com',
      );

      expect(result).not.toHaveProperty('devToken');
      process.env.APP_ENV = originalEnv;
    });

    it('NÃO expõe o devToken com APP_ENV ausente (responde como produção)', async () => {
      const originalEnv = process.env.APP_ENV;
      delete process.env.APP_ENV;
      mockPrisma.mailVerification.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.mailVerification.upsert.mockResolvedValueOnce({});

      const result = await service.sendEmailValidation('usuario@empresa.com');

      expect(result).not.toHaveProperty('devToken');
      if (originalEnv !== undefined) process.env.APP_ENV = originalEnv;
    });

    it('token ainda válido: devolve o mesmo código só em ambiente de teste', async () => {
      const originalEnv = process.env.APP_ENV;
      const existing = {
        token: '1234',
        expiresAt: new Date(Date.now() + 60_000),
      };

      process.env.APP_ENV = 'homolog';
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(existing);
      await expect(
        service.sendEmailValidation('usuario@empresa.com'),
      ).resolves.toHaveProperty('devToken', '1234');

      process.env.APP_ENV = 'production';
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(existing);
      await expect(
        service.sendEmailValidation('qualquer@atrupe-test.com'),
      ).resolves.not.toHaveProperty('devToken');

      process.env.APP_ENV = originalEnv;
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // verifyEmail
  // ───────────────────────────────────────────────────────────────────────────

  describe('verifyEmail', () => {
    it('deve lançar BadRequestException para token inválido ou expirado', async () => {
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.verifyEmail({ email: 'usuario@empresa.com', token: '9999' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve marcar o email como verificado e limpar o token quando token é válido', async () => {
      const verif = makeVerification();
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(verif);
      mockPrisma.mailVerification.update.mockResolvedValueOnce({});

      const result = await service.verifyEmail({
        email: 'usuario@empresa.com',
        token: '1234',
      });

      expect(mockPrisma.mailVerification.update).toHaveBeenCalledWith({
        where: { email: verif.email },
        data: { verified: true, token: null, expiresAt: null },
      });
      expect(result.message).toBe('Email verificado com sucesso.');
    });

    it('deve normalizar o email para lowercase na verificação', async () => {
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.verifyEmail({ email: 'USUARIO@EMPRESA.COM', token: '1234' }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.mailVerification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ email: 'usuario@empresa.com' }),
        }),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // createPassword
  // ───────────────────────────────────────────────────────────────────────────

  describe('createPassword', () => {
    it('deve lançar BadRequestException se o email não foi verificado', async () => {
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createPassword(makeCreateUserDto() as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve criar usuário, empresa e plano TRIAL quando tudo está correto', async () => {
      // Email verificado
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(
        makeVerification({ verified: true }),
      );

      const trialPlan = {
        id: 'plan-trial',
        planType: 'TRIAL',
        planLimits: [{ limit: { key: 'trial_days' }, value: 14 }],
      };
      const newUser = { id: 'user-1', email: 'usuario@empresa.com' };
      const newCustomer = { id: 'cust-1', email: 'usuario@empresa.com' };

      // Simulando a transaction do Prisma
      mockPrisma.$transaction.mockImplementationOnce(async (cb) => {
        const tx = {
          user: {
            create: jest.fn().mockResolvedValue(newUser),
            update: jest.fn(),
          },
          customer: { create: jest.fn().mockResolvedValue(newCustomer) },
          subscription: { create: jest.fn() },
          plan: { findFirst: jest.fn().mockResolvedValue(trialPlan) },
        };
        return cb(tx);
      });

      mockCompanyService.createMainCompany.mockResolvedValueOnce({
        id: 'company-1',
      });
      mockCompanyService.createFirstAccess.mockResolvedValueOnce(undefined);
      mockPrisma.customer.update.mockResolvedValueOnce({});
      mockPrisma.subscription.updateMany.mockResolvedValueOnce({});
      mockPrisma.mailVerification.deleteMany.mockResolvedValueOnce({});

      const result = await service.createPassword(makeCreateUserDto() as any);

      expect(mockCompanyService.createMainCompany).toHaveBeenCalledTimes(1);
      expect(mockCompanyService.createFirstAccess).toHaveBeenCalledTimes(1);
      expect(mockPrisma.mailVerification.deleteMany).toHaveBeenCalledWith({
        where: { email: 'usuario@empresa.com' },
      });
      expect(result.message).toBe(
        'Usuário criado com sucesso com plano TRIAL.',
      );
    });

    it('desfaz usuário, teste e cliente quando o primeiro acesso falha, para o e-mail poder tentar de novo', async () => {
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(
        makeVerification({ verified: true }),
      );
      mockPrisma.$transaction.mockImplementationOnce(async (cb) =>
        cb({
          user: {
            create: jest.fn().mockResolvedValue({ id: 'user-1' }),
            update: jest.fn(),
          },
          customer: { create: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
          subscription: { create: jest.fn() },
          plan: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'plan-trial',
              planType: 'TRIAL',
              planLimits: [],
            }),
          },
        }),
      );
      mockCompanyService.createMainCompany.mockResolvedValueOnce({
        id: 'company-1',
      });
      mockPrisma.customer.update.mockResolvedValueOnce({});
      mockPrisma.subscription.updateMany.mockResolvedValueOnce({});
      mockCompanyService.createFirstAccess.mockRejectedValueOnce(
        new Error('User not found'),
      );
      mockPrisma.company.delete.mockResolvedValueOnce({});
      mockPrisma.user.delete.mockResolvedValueOnce({});
      mockPrisma.subscription.deleteMany.mockResolvedValueOnce({});
      mockPrisma.customer.delete.mockResolvedValueOnce({});

      await expect(
        service.createPassword(makeCreateUserDto() as any),
      ).rejects.toThrow('User not found');

      expect(mockPrisma.company.delete).toHaveBeenCalledWith({
        where: { id: 'company-1' },
      });
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(mockPrisma.subscription.deleteMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1' },
      });
      expect(mockPrisma.customer.delete).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
      });
      // A verificação do e-mail continua valendo para a nova tentativa.
      expect(mockPrisma.mailVerification.deleteMany).not.toHaveBeenCalled();
    });

    it('deve gerar event_id e persistir a atribuição (oppref/utm) no usuário', async () => {
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(
        makeVerification({ verified: true }),
      );

      const trialPlan = {
        id: 'plan-trial',
        planType: 'TRIAL',
        planLimits: [{ limit: { key: 'trial_days' }, value: 14 }],
      };
      const newUser = { id: 'user-1', email: 'usuario@empresa.com' };
      const newCustomer = { id: 'cust-1', email: 'usuario@empresa.com' };

      // Captura o mock do user.create para inspecionar o data enviado.
      const userCreate = jest.fn().mockResolvedValue(newUser);
      mockPrisma.$transaction.mockImplementationOnce(async (cb) => {
        const tx = {
          user: { create: userCreate, update: jest.fn() },
          customer: { create: jest.fn().mockResolvedValue(newCustomer) },
          subscription: { create: jest.fn() },
          plan: { findFirst: jest.fn().mockResolvedValue(trialPlan) },
        };
        return cb(tx);
      });

      mockCompanyService.createMainCompany.mockResolvedValueOnce({
        id: 'company-1',
      });
      mockCompanyService.createFirstAccess.mockResolvedValueOnce(undefined);
      mockPrisma.customer.update.mockResolvedValueOnce({});
      mockPrisma.subscription.updateMany.mockResolvedValueOnce({});
      mockPrisma.mailVerification.deleteMany.mockResolvedValueOnce({});

      const oppref = 'op_teste_123';
      const gclid = 'gclid_teste_abc';
      const utm = { utm_source: 'chatgpt', utm_medium: 'cpc' };
      const result = await service.createPassword(
        makeCreateUserDto({ oppref, utm, gclid }) as any,
      );

      // Contrato §5.2: retorna um event_id (UUID) não vazio.
      expect(result.eventId).toEqual(expect.any(String));
      expect(result.eventId.length).toBeGreaterThan(0);

      // §6.2: atribuição + event_id gravados no usuário, e o event_id retornado
      // é o mesmo persistido.
      const userData = userCreate.mock.calls[0][0].data;
      expect(userData.signupEventId).toBe(result.eventId);
      expect(userData.signupOppref).toBe(oppref);
      expect(userData.signupUtm).toEqual(utm);
      expect(userData.signupGclid).toBe(gclid);
    });

    it('deve lançar ConflictException se o email já foi cadastrado (P2002)', async () => {
      mockPrisma.mailVerification.findFirst.mockResolvedValueOnce(
        makeVerification({ verified: true }),
      );

      const prismaError = new PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '5.0' },
      );
      mockPrisma.$transaction.mockRejectedValueOnce(prismaError);

      await expect(
        service.createPassword(makeCreateUserDto() as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // create (inicio do cadastro — pré verificação)
  // ───────────────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('deve lançar ConflictException se o email já tem um usuário', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'u-1' });

      await expect(
        service.create({ email: 'usuario@empresa.com' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('deve lançar ConflictException se o email já tem um customer', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.customer.findFirst.mockResolvedValueOnce({ id: 'c-1' });

      await expect(
        service.create({ email: 'usuario@empresa.com' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('deve chamar sendEmailValidation quando o email está disponível', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.customer.findFirst.mockResolvedValueOnce(null);
      // Para sendEmailValidation internamente: sem token ativo, sem colisão de token
      mockPrisma.mailVerification.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrisma.mailVerification.upsert.mockResolvedValueOnce({});

      const dto = {
        email: 'novo@empresa.com',
        name: 'Novo',
        companyName: 'Nova Empresa',
        phone: '11999',
      };
      const result = await service.create(dto as any);

      expect(result.message).toBe('Email de validação enviado com sucesso.');
    });
  });
});
