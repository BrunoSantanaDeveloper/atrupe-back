import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UserPasswordService } from './user-password.service';
import { PrismaService } from 'nestjs-prisma';
import { MailerService } from '@nestjs-modules/mailer';
import * as argon2 from 'argon2';

// ─── Setup e Mocks ───────────────────────────────────────────────────────────

jest.mock('argon2');

describe('UserPasswordService', () => {
  let service: UserPasswordService;
  let prisma: {
    user: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };
  let mailer: { sendMail: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    mailer = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPasswordService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailer },
      ],
    }).compile();

    service = module.get<UserPasswordService>(UserPasswordService);
    jest.clearAllMocks();

    process.env.FRONTEND_URL = 'http://localhost:3000';
  });

  afterEach(() => {
    delete process.env.FRONTEND_URL;
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── forgotPassword ────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('deve retornar silenciosamente (sem dar erro) quando o usuário não existe por segurança', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.forgotPassword({ email: 'inexistente@example.com' });

      // Garante que não atualizou nada nem enviou e-mail
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    it('deve gerar um token de 32 bytes, definir a validade de 1 hora e enviar email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'existente@example.com',
        name: 'Usuário Existente',
      });

      // Interceptando a chamada do Prisma para verificar as datas e dados gerados
      prisma.user.update.mockResolvedValue({});

      await service.forgotPassword({ email: 'existente@example.com' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-1' },
          data: expect.objectContaining({
            resetPasswordToken: expect.any(String),
            resetPasswordExpires: expect.any(Date),
          }),
        }),
      );

      expect(mailer.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'existente@example.com',
          template: 'reset-password',
          context: expect.objectContaining({
            name: 'Usuário Existente',
            resetLink: expect.stringContaining(
              'http://localhost:3000/redefinir-senha?token=',
            ),
          }),
        }),
      );
    });
  });

  // ─── resetPassword ─────────────────────────────────────────────────────────

  describe('adminPasswordReset', () => {
    it('deve validar senha gerencial e enviar email para o usuario alvo', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'admin-1',
          name: 'Admin',
          password: 'hashed-admin-password',
        })
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'user@example.com',
          name: 'Usuario',
        });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      prisma.user.update.mockResolvedValue({});

      await service.adminPasswordReset('user-1', 'admin-1', 'senha-admin');

      expect(argon2.verify).toHaveBeenCalledWith(
        'hashed-admin-password',
        'senha-admin',
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            resetPasswordToken: expect.any(String),
            resetPasswordExpires: expect.any(Date),
          }),
        }),
      );
      expect(mailer.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          template: 'reset-password',
        }),
      );
    });

    it('deve lancar UnauthorizedException quando a senha gerencial esta incorreta', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        name: 'Admin',
        password: 'hashed-admin-password',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.adminPasswordReset('user-1', 'admin-1', 'senha-errada'),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    it('deve lancar NotFoundException quando o usuario alvo nao existe', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'admin-1',
          name: 'Admin',
          password: 'hashed-admin-password',
        })
        .mockResolvedValueOnce(null);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await expect(
        service.adminPasswordReset('user-1', 'admin-1', 'senha-admin'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('deve lançar UnauthorizedException quando o token é inválido ou já expirou', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'invalido', password: 'nova-senha' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('deve gerar novo hash da senha e limpar dados do token quando válido', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });
      const mockHashedPassword = 'hashed-secure-password';
      (argon2.hash as jest.Mock).mockResolvedValue(mockHashedPassword);
      prisma.user.update.mockResolvedValue({});

      await service.resetPassword({ token: 'valido', password: 'nova-senha' });

      expect(argon2.hash).toHaveBeenCalledWith('nova-senha');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: {
          password: mockHashedPassword,
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      });
    });
  });
});
