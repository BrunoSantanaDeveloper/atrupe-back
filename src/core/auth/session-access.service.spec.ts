import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { SessionAccessService } from './session-access.service';

describe('SessionAccessService', () => {
  const prisma = {
    employee: { findUnique: jest.fn() },
    user: { findFirst: jest.fn() },
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
