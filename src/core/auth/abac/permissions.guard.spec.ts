import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AbacService } from './abac.service';

/**
 * O PermissionsGuard usa duas chaves de metadata distintas:
 *   - HAS_ANY_PERMISSION_KEY (lógica OR entre múltiplos recursos)
 *   - HAS_PERMISSION_KEY     (recurso único)
 * O reflector.get é chamado em sequência para as duas.
 */

function makeCtx(user: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: jest.Mocked<Reflector>;
  let abacService: jest.Mocked<AbacService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: { get: jest.fn() },
        },
        {
          provide: AbacService,
          useValue: {
            hasPermission: jest.fn(),
            hasAnyPermission: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get(Reflector);
    abacService = module.get(AbacService);

    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('deve negar quando não há usuário autenticado', async () => {
      const ctx = makeCtx(null);
      // reflector não precisa nem ser chamado
      const result = await guard.canActivate(ctx);
      expect(result).toBe(false);
    });

    it('deve permitir quando não há nenhum decorator de permissão (rota pública autenticada)', async () => {
      // Primeira chamada: HAS_ANY_PERMISSION_KEY → undefined
      // Segunda chamada: HAS_PERMISSION_KEY → undefined
      reflector.get.mockReturnValue(undefined);
      const ctx = makeCtx({ id: 'u-1', role: 'role-1' });
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(abacService.hasPermission).not.toHaveBeenCalled();
    });

    it('deve chamar hasPermission quando @HasPermission está presente', async () => {
      // HAS_ANY_PERMISSION_KEY → undefined (sem esse decorator)
      // HAS_PERMISSION_KEY → { action, resource }
      reflector.get
        .mockReturnValueOnce(undefined) // HAS_ANY_PERMISSION_KEY
        .mockReturnValueOnce({ action: 'create', resource: 'client' }); // HAS_PERMISSION_KEY

      abacService.hasPermission.mockResolvedValue(true);

      const ctx = makeCtx({ id: 'u-1', role: 'role-1' });
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(abacService.hasPermission).toHaveBeenCalledWith(
        { id: 'u-1', role: 'role-1' },
        'create',
        'client',
      );
    });

    it('deve negar quando abacService.hasPermission retorna false', async () => {
      reflector.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ action: 'delete', resource: 'client' });

      abacService.hasPermission.mockResolvedValue(false);

      const ctx = makeCtx({ id: 'u-1', role: 'role-1' });
      const result = await guard.canActivate(ctx);
      expect(result).toBe(false);
    });

    it('deve chamar hasAnyPermission quando @HasAnyPermission está presente', async () => {
      const anyPerms = [
        { action: 'view', resource: 'receivable' },
        { action: 'view', resource: 'flow' },
      ];
      // HAS_ANY_PERMISSION_KEY → array de permissões
      reflector.get.mockReturnValueOnce(anyPerms);
      abacService.hasAnyPermission.mockResolvedValue(true);

      const ctx = makeCtx({ id: 'u-1', role: 'role-1' });
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(abacService.hasAnyPermission).toHaveBeenCalledWith(
        { id: 'u-1', role: 'role-1' },
        anyPerms,
      );
      // hasPermission NÃO deve ser chamado quando hasAnyPermission é resolvido
      expect(abacService.hasPermission).not.toHaveBeenCalled();
    });

    it('deve negar quando hasAnyPermission retorna false', async () => {
      reflector.get.mockReturnValueOnce([
        { action: 'delete', resource: 'receivable' },
      ]);
      abacService.hasAnyPermission.mockResolvedValue(false);

      const ctx = makeCtx({ id: 'u-1', role: 'role-1' });
      expect(await guard.canActivate(ctx)).toBe(false);
    });
  });
});
