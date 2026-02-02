import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AbacService } from './abac.service';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: jest.Mocked<Reflector>;
  let abacService: jest.Mocked<AbacService>;

  const mockExecutionContext = {
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          userId: 'user-123',
          role: 'role-123',
        },
      }),
    }),
    getHandler: () => jest.fn(),
  } as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: AbacService,
          useValue: {
            getPermissionsByRole: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get(Reflector);
    abacService = module.get(AbacService);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should return true when no permission required', async () => {
      reflector.get.mockReturnValue(undefined);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should return true when user is admin', async () => {
      reflector.get.mockReturnValue({ action: 'create', resource: 'client' });
      abacService.getPermissionsByRole.mockResolvedValue({
        isAdmin: true,
        permissions: [],
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should return true when user has permission', async () => {
      reflector.get.mockReturnValue({ action: 'create', resource: 'client' });
      abacService.getPermissionsByRole.mockResolvedValue({
        isAdmin: false,
        permissions: ['client:create', 'client:view'],
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
    });

    it('should return false when user lacks permission', async () => {
      reflector.get.mockReturnValue({ action: 'delete', resource: 'client' });
      abacService.getPermissionsByRole.mockResolvedValue({
        isAdmin: false,
        permissions: ['client:create', 'client:view'],
      });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(false);
    });

    it('should return false when user has no role', async () => {
      const contextWithoutRole = {
        switchToHttp: () => ({
          getRequest: () => ({
            user: { userId: 'user-123' },
          }),
        }),
        getHandler: () => jest.fn(),
      } as unknown as ExecutionContext;

      reflector.get.mockReturnValue({ action: 'create', resource: 'client' });

      const result = await guard.canActivate(contextWithoutRole);

      expect(result).toBe(false);
    });

    it('should return false when no user in request', async () => {
      const contextWithoutUser = {
        switchToHttp: () => ({
          getRequest: () => ({}),
        }),
        getHandler: () => jest.fn(),
      } as unknown as ExecutionContext;

      reflector.get.mockReturnValue({ action: 'create', resource: 'client' });

      const result = await guard.canActivate(contextWithoutUser);

      expect(result).toBe(false);
    });
  });
});
