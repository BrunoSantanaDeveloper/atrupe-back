import { Test, TestingModule } from '@nestjs/testing';
import { AbacService } from './abac.service';
import { PrismaService } from 'src/config/prisma/prisma.service';

describe('AbacService', () => {
  let service: AbacService;
  let prisma: jest.Mocked<PrismaService>;

  const mockRole = {
    id: 'role-123',
    permissions: ['client:create', 'client:view', 'product:view'],
    isAdmin: false,
  };

  const mockAdminRole = {
    id: 'admin-role',
    permissions: [],
    isAdmin: true,
  };

  const mockUserWithEmployee = {
    employee: [
      {
        role: mockRole,
      },
    ],
    userRole: [],
  };

  const mockSystemAdmin = {
    employee: [],
    userRole: [{ isSystemAdmin: true, role: null }],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbacService,
        {
          provide: PrismaService,
          useValue: {
            role: {
              findUnique: jest.fn(),
            },
            user: {
              findFirst: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AbacService>(AbacService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPermissionsByRole', () => {
    it('should return permissions for a role', async () => {
      (prisma.role.findUnique as jest.Mock).mockResolvedValue(mockRole);

      const result = await service.getPermissionsByRole('role-123');

      expect(result).toHaveProperty('permissions');
      expect(result.permissions).toContain('client:create');
    });

    it('should return isAdmin flag', async () => {
      (prisma.role.findUnique as jest.Mock).mockResolvedValue(mockAdminRole);

      const result = await service.getPermissionsByRole('admin-role');

      expect(result.isAdmin).toBe(true);
    });
  });

  describe('hasPermission', () => {
    const user = { userId: 'user-123', username: 'test@example.com' };

    it('should return true for system admin', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(mockSystemAdmin);

      const result = await service.hasPermission(user, 'create', 'client');

      expect(result).toBe(true);
    });

    it('should return true when user has permission', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(
        mockUserWithEmployee,
      );

      const result = await service.hasPermission(user, 'create', 'client');

      expect(result).toBe(true);
    });

    it('should return false when user lacks permission', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(
        mockUserWithEmployee,
      );

      const result = await service.hasPermission(user, 'delete', 'client');

      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.hasPermission(user, 'create', 'client');

      expect(result).toBe(false);
    });

    it('should handle 3-part permissions (category:resource:action)', async () => {
      const userWith3PartPerm = {
        ...mockUserWithEmployee,
        employee: [
          {
            role: {
              permissions: ['sale:other_quotation:view'],
              isAdmin: false,
            },
          },
        ],
      };
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(userWith3PartPerm);

      const result = await service.hasPermission(
        user,
        'view',
        'sale:other_quotation',
      );

      expect(result).toBe(true);
    });
  });
});
