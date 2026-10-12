process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { SessionAccessService } from './session-access.service';

describe('SessionAccessService', () => {
  const prisma = {
    employee: { findUnique: jest.fn() },
    user: { findFirst: jest.fn(), findUnique: jest.fn() },
    ownershipTransfer: { findFirst: jest.fn() },
  };
  let service: SessionAccessService;

  const claims = { sub: 'user-1', companyId: 'company-1', employeeId: 'emp-1' };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionAccessService(prisma as any);
  });

  describe('assertLinked', () => {
    it('administrador do sistema, sem empresa, não é conferido', async () => {
      await service.assertLinked({ sub: 'admin', companyId: null });
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });

    it('vínculo em dia passa, e fica em cache por alguns segundos', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        userId: 'user-1',
        companyId: 'company-1',
        user: { isActive: true },
      });

      await service.assertLinked(claims);
      await service.assertLinked(claims);

      expect(prisma.employee.findUnique).toHaveBeenCalledTimes(1);
    });

    it('quem transferiu o ambiente (colaborador sem usuário) é barrado na hora', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        userId: null,
        companyId: 'company-1',
      });

      await expect(service.assertLinked(claims)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(service.assertLinked(claims)).rejects.toMatchObject({
        response: { code: 'SESSION_REVOKED' },
      });
    });

    it('colaborador de outra empresa não vale para esta', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        userId: 'user-1',
        companyId: 'outra',
      });

      await expect(service.assertLinked(claims)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('forgetUser descarta o cache: a transferência vale na requisição seguinte', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        userId: 'user-1',
        companyId: 'company-1',
        user: { isActive: true },
      });
      await service.assertLinked(claims);

      service.forgetUser('user-1');
      prisma.employee.findUnique.mockResolvedValueOnce({
        userId: null,
        companyId: 'company-1',
      });

      await expect(service.assertLinked(claims)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('usuário inativado', () => {
    it('a sessão cai na requisição seguinte, com a mensagem de sessão encerrada', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        userId: 'user-1',
        companyId: 'company-1',
        user: { isActive: false },
      });

      await expect(service.assertLinked(claims)).rejects.toMatchObject({
        response: {
          code: 'SESSION_REVOKED',
          message: 'Sua sessão foi encerrada. Entre novamente.',
        },
      });
      expect(prisma.employee.findUnique).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        select: {
          userId: true,
          companyId: true,
          user: { select: { isActive: true } },
        },
      });
    });
  });

  describe('passwordStamp', () => {
    it('é estável para o mesmo hash e muda quando o hash muda', async () => {
      const first = await argon2.hash('Senha@123');
      const again = await argon2.hash('Senha@123');

      expect(service.passwordStamp(first)).toBe(service.passwordStamp(first));
      // O hash tem sal: até a mesma senha gravada de novo muda a impressão
      expect(service.passwordStamp(again)).not.toBe(
        service.passwordStamp(first),
      );
      expect(service.passwordStamp(first)).not.toContain(first);
    });
  });

  describe('assertRefreshable', () => {
    const hash = 'hash-da-senha-gravada';
    let stamp: string;

    beforeEach(() => {
      stamp = service.passwordStamp(hash);
      prisma.employee.findUnique.mockResolvedValue({
        userId: 'user-1',
        companyId: 'company-1',
        user: { isActive: true },
      });
    });

    it('sessão em dia renova e devolve a impressão para os tokens novos', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isActive: true,
        password: hash,
      });

      await expect(
        service.assertRefreshable({ ...claims, pwd: stamp }),
      ).resolves.toBe(stamp);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { isActive: true, password: true },
      });
    });

    it('senha trocada depois da emissão encerra a sessão', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isActive: true,
        password: 'hash-da-senha-nova',
      });

      await expect(
        service.assertRefreshable({ ...claims, pwd: stamp }),
      ).rejects.toMatchObject({ response: { code: 'SESSION_REVOKED' } });
    });

    it('usuário inativo não renova', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isActive: false,
        password: hash,
      });

      await expect(
        service.assertRefreshable({ ...claims, pwd: stamp }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('token sem a impressão (emitido antes da conferência) não renova', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isActive: true,
        password: hash,
      });

      await expect(service.assertRefreshable(claims)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('vínculo desfeito (transferência) também barra a renovação', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isActive: true,
        password: hash,
      });
      prisma.employee.findUnique.mockResolvedValue({
        userId: null,
        companyId: 'company-1',
        user: null,
      });

      await expect(
        service.assertRefreshable({ ...claims, pwd: stamp }),
      ).rejects.toMatchObject({ response: { code: 'SESSION_REVOKED' } });
    });

    it('administrador do sistema renova sem conferir vínculo', async () => {
      prisma.user.findUnique.mockResolvedValue({
        isActive: true,
        password: hash,
      });

      await expect(
        service.assertRefreshable({
          sub: 'admin',
          companyId: null,
          employeeId: null,
          pwd: stamp,
        }),
      ).resolves.toBe(stamp);
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('transferredAccess', () => {
    // Um hash só: argon2 é caro de propósito, e sob a suíte inteira estoura o tempo.
    let senhaHash: string;
    beforeAll(async () => {
      senhaHash = await argon2.hash('Senha@123');
    });

    it('com a senha certa, diz qual transferência tirou o acesso', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        password: senhaHash,
      });
      const acceptedAt = new Date('2026-09-20T15:00:00.000Z');
      prisma.ownershipTransfer.findFirst.mockResolvedValue({
        companyName: 'Marcenaria Horizonte',
        acceptedAt,
      });

      await expect(
        service.transferredAccess('saiu@exemplo.com', 'Senha@123'),
      ).resolves.toEqual({ companyName: 'Marcenaria Horizonte', acceptedAt });
    });

    it('com a senha errada não conta nada', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        password: senhaHash,
      });

      await expect(
        service.transferredAccess('saiu@exemplo.com', 'outra'),
      ).resolves.toBeNull();
      expect(prisma.ownershipTransfer.findFirst).not.toHaveBeenCalled();
    });

    it('conta desativada por outro motivo segue com a recusa comum', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        password: senhaHash,
      });
      prisma.ownershipTransfer.findFirst.mockResolvedValue(null);

      await expect(
        service.transferredAccess('inativo@exemplo.com', 'Senha@123'),
      ).resolves.toBeNull();
    });
  });
});
