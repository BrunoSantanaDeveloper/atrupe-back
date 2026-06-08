import { Test, TestingModule } from '@nestjs/testing';
import { AbacService } from './abac.service';
import { PrismaService } from 'src/config/prisma/prisma.service';

describe('AbacService — cenários reais de hasPermission', () => {
  let service: AbacService;
  let prisma: { role: { findUnique: jest.Mock }; user?: any };

  beforeEach(async () => {
    prisma = { role: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AbacService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AbacService>(AbacService);
    jest.clearAllMocks();
  });

  // ── hasPermission via JWT payload ─────────────────────────────────────────

  describe('hasPermission (via JWT payload — uso real)', () => {
    it('deve permitir para isSystemAdmin=true sem consultar banco', async () => {
      const user = { isSystemAdmin: true };
      const result = await service.hasPermission(user, 'delete', 'client');
      expect(result).toBe(true);
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
    });

    it('deve permitir para isAdmin=true sem consultar banco', async () => {
      const user = { isSystemAdmin: false, isAdmin: true };
      const result = await service.hasPermission(user, 'delete', 'invoice');
      expect(result).toBe(true);
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
    });

    it('deve negar quando user.role não está definido', async () => {
      const user = { isSystemAdmin: false, isAdmin: false };
      const result = await service.hasPermission(user, 'create', 'client');
      expect(result).toBe(false);
    });

    it('deve negar quando role não existe no banco', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      const user = {
        isSystemAdmin: false,
        isAdmin: false,
        role: 'role-fantasma',
      };
      const result = await service.hasPermission(user, 'create', 'client');
      expect(result).toBe(false);
    });

    it('deve negar quando role existe mas permissões estão vazias', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: [],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };
      const result = await service.hasPermission(user, 'create', 'client');
      expect(result).toBe(false);
    });

    it('deve permitir com permissão exata "client:create"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['client:create', 'client:view'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };
      expect(await service.hasPermission(user, 'create', 'client')).toBe(true);
    });

    it('deve negar para ação "delete" quando só tem "client:create"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['client:create'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };
      expect(await service.hasPermission(user, 'delete', 'client')).toBe(false);
    });

    it('deve permitir com wildcard de ação "client:*"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['client:*'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };
      expect(await service.hasPermission(user, 'delete', 'client')).toBe(true);
      expect(await service.hasPermission(user, 'export', 'client')).toBe(true);
    });

    it('deve permitir com wildcard global "*"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['*'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };
      expect(await service.hasPermission(user, 'delete', 'invoice')).toBe(true);
    });

    it('deve permitir com permissão de 3 partes "sale:quotation:view"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['sale:quotation:view'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };
      expect(await service.hasPermission(user, 'view', 'sale:quotation')).toBe(
        true,
      );
    });

    it('deve negar para ação diferente com 3 partes "sale:quotation:create"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['sale:quotation:create'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };
      expect(
        await service.hasPermission(user, 'delete', 'sale:quotation'),
      ).toBe(false);
    });

    it('deve negar export quando usuario so tem view no recurso', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['sale:quotation:view'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };

      expect(
        await service.hasPermission(user, 'export', 'sale:quotation'),
      ).toBe(false);
    });

    it('deve permitir export quando usuario tem permissao export explicita', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['sale:quotation:export'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };

      expect(
        await service.hasPermission(user, 'export', 'sale:quotation'),
      ).toBe(true);
    });

    it('deve permitir quando role.isAdmin=true mesmo sem listar permissões', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: [],
        isAdmin: true,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-admin' };
      expect(await service.hasPermission(user, 'delete', 'anything')).toBe(
        true,
      );
    });
  });

  // ── hasAnyPermission ──────────────────────────────────────────────────────

  describe('hasAnyPermission', () => {
    it('deve retornar true se pelo menos uma permissão é satisfeita (lógica OR)', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['flow:view'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };

      const result = await service.hasAnyPermission(user, [
        { action: 'view', resource: 'receivable' }, // FALSE
        { action: 'view', resource: 'flow' }, // TRUE
      ]);
      expect(result).toBe(true);
    });

    it('deve retornar false quando nenhuma permissão é satisfeita', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['client:view'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };

      const result = await service.hasAnyPermission(user, [
        { action: 'delete', resource: 'client' },
        { action: 'export', resource: 'invoice' },
      ]);
      expect(result).toBe(false);
    });

    it('deve fazer curto-circuito e parar na primeira permissão satisfeita', async () => {
      prisma.role.findUnique.mockResolvedValueOnce({
        permissions: ['client:delete'],
        isAdmin: false,
      });
      const user = { isSystemAdmin: false, isAdmin: false, role: 'role-1' };

      const result = await service.hasAnyPermission(user, [
        { action: 'delete', resource: 'client' }, // TRUE — para aqui
        { action: 'export', resource: 'invoice' }, // não chega aqui
      ]);
      expect(result).toBe(true);
      // findUnique chamado apenas 1x (curto-circuito)
      expect(prisma.role.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});
