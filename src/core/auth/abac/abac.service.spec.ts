import { Test, TestingModule } from '@nestjs/testing';
import { AbacService } from './abac.service';
import { PrismaService } from 'src/config/prisma/prisma.service';

/**
 * AbacService recebe o payload do JWT (não o User completo do banco).
 * As propriedades relevantes são: isSystemAdmin, isAdmin, role (id da role).
 */
describe('AbacService', () => {
  let service: AbacService;
  let prisma: { role: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { role: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AbacService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AbacService>(AbacService);
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ── getPermissionsByRole ──────────────────────────────────────────────────

  describe('getPermissionsByRole', () => {
    it('deve retornar permissões e isAdmin para uma role existente', async () => {
      const mockRole = {
        id: 'role-1',
        permissions: ['client:create', 'client:view'],
        isAdmin: false,
      };
      prisma.role.findUnique.mockResolvedValue(mockRole);

      const result = await service.getPermissionsByRole('role-1');
      expect(result).toHaveProperty('permissions');
      expect((result as any).permissions).toContain('client:create');
    });

    it('deve retornar isAdmin=true para roles de administrador', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: [],
        isAdmin: true,
      });
      const result = await service.getPermissionsByRole('admin-role');
      expect(result.isAdmin).toBe(true);
    });
  });

  // ── hasPermission ─────────────────────────────────────────────────────────

  describe('hasPermission', () => {
    it('deve retornar true imediatamente para isSystemAdmin=true', async () => {
      const result = await service.hasPermission(
        { isSystemAdmin: true },
        'delete',
        'anything',
      );
      expect(result).toBe(true);
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
    });

    it('deve retornar true imediatamente para isAdmin=true', async () => {
      const result = await service.hasPermission(
        { isSystemAdmin: false, isAdmin: true },
        'delete',
        'anything',
      );
      expect(result).toBe(true);
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
    });

    it('deve retornar false quando usuário não tem role definida', async () => {
      const result = await service.hasPermission(
        { isSystemAdmin: false, isAdmin: false },
        'create',
        'client',
      );
      expect(result).toBe(false);
      expect(prisma.role.findUnique).not.toHaveBeenCalled();
    });

    it('deve retornar false quando role não existe no banco', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      const result = await service.hasPermission(
        { isSystemAdmin: false, isAdmin: false, role: 'role-fantasma' },
        'create',
        'client',
      );
      expect(result).toBe(false);
    });

    it('deve retornar true quando role.isAdmin=true', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: [],
        isAdmin: true,
      });
      const result = await service.hasPermission(
        { isSystemAdmin: false, isAdmin: false, role: 'role-admin' },
        'delete',
        'client',
      );
      expect(result).toBe(true);
    });

    it('deve retornar true para permissão exata "client:create"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['client:create', 'client:view'],
        isAdmin: false,
      });
      const result = await service.hasPermission(
        { isSystemAdmin: false, isAdmin: false, role: 'role-1' },
        'create',
        'client',
      );
      expect(result).toBe(true);
    });

    it('deve retornar false para ação não permitida', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['client:create'],
        isAdmin: false,
      });
      const result = await service.hasPermission(
        { isSystemAdmin: false, isAdmin: false, role: 'role-1' },
        'delete',
        'client',
      );
      expect(result).toBe(false);
    });

    it('deve retornar true com wildcard de ação "client:*"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['client:*'],
        isAdmin: false,
      });
      expect(
        await service.hasPermission(
          { isSystemAdmin: false, isAdmin: false, role: 'r' },
          'delete',
          'client',
        ),
      ).toBe(true);
    });

    it('deve retornar true com wildcard global "*"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['*'],
        isAdmin: false,
      });
      expect(
        await service.hasPermission(
          { isSystemAdmin: false, isAdmin: false, role: 'r' },
          'export',
          'invoice',
        ),
      ).toBe(true);
    });

    it('deve retornar true para permissão de 3 partes "sale:quotation:view"', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['sale:quotation:view'],
        isAdmin: false,
      });
      const result = await service.hasPermission(
        { isSystemAdmin: false, isAdmin: false, role: 'r' },
        'view',
        'sale:quotation',
      );
      expect(result).toBe(true);
    });

    it('deve retornar false para ação diferente em permissão de 3 partes', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['sale:quotation:create'],
        isAdmin: false,
      });
      const result = await service.hasPermission(
        { isSystemAdmin: false, isAdmin: false, role: 'r' },
        'delete',
        'sale:quotation',
      );
      expect(result).toBe(false);
    });
  });

  // ── hasAnyPermission ──────────────────────────────────────────────────────

  describe('hasAnyPermission', () => {
    it('deve retornar true se pelo menos uma permissão é satisfeita (OR)', async () => {
      prisma.role.findUnique
        .mockResolvedValueOnce({ permissions: ['client:view'], isAdmin: false }) // FALSE
        .mockResolvedValueOnce({ permissions: ['flow:view'], isAdmin: false }); // TRUE

      const result = await service.hasAnyPermission(
        { isSystemAdmin: false, isAdmin: false, role: 'r' },
        [
          { action: 'delete', resource: 'client' },
          { action: 'view', resource: 'flow' },
        ],
      );
      expect(result).toBe(true);
    });

    it('deve retornar false quando nenhuma permissão é satisfeita', async () => {
      prisma.role.findUnique.mockResolvedValue({
        permissions: ['client:view'],
        isAdmin: false,
      });
      const result = await service.hasAnyPermission(
        { isSystemAdmin: false, isAdmin: false, role: 'r' },
        [
          { action: 'delete', resource: 'client' },
          { action: 'export', resource: 'invoice' },
        ],
      );
      expect(result).toBe(false);
    });
  });
});
