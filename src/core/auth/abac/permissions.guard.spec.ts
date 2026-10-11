import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSION_DENIED,
  PERMISSION_DENIED_MESSAGE,
  PermissionsGuard,
} from './permissions.guard';
import { AbacService } from './abac.service';

/**
 * O PermissionsGuard usa duas chaves de metadata distintas:
 *   - HAS_ANY_PERMISSION_KEY (lógica OR entre múltiplos recursos)
 *   - HAS_PERMISSION_KEY     (recurso único)
 * O reflector.get é chamado em sequência para as duas. O modo "observar"
 * (OBSERVE_PERMISSIONS_KEY) é lido com getAllAndOverride, na rota e na
 * classe, só quando a permissão falta.
 */

function makeCtx(user: any, extra: Record<string, any> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, ...extra }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

async function denial(promise: Promise<boolean>) {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(ForbiddenException);
  return (error as ForbiddenException).getResponse() as Record<string, any>;
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
          useValue: { get: jest.fn(), getAllAndOverride: jest.fn() },
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
      // Com a permissão, o modo "observar" nem é consultado
      expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
    });

    it('deve recusar em português, com código e a permissão exigida, quando hasPermission retorna false', async () => {
      reflector.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ action: 'delete', resource: 'client' });

      abacService.hasPermission.mockResolvedValue(false);

      const ctx = makeCtx({ id: 'u-1', role: 'role-1' });
      const body = await denial(guard.canActivate(ctx));
      expect(body).toEqual({
        statusCode: 403,
        error: 'Forbidden',
        code: PERMISSION_DENIED,
        message: PERMISSION_DENIED_MESSAGE,
        permissions: ['client:delete'],
      });
      expect(body.message).toBe('Você não tem permissão para esta ação.');
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

    it('deve recusar quando hasAnyPermission retorna false, listando todas as alternativas', async () => {
      reflector.get.mockReturnValueOnce([
        { action: 'delete', resource: 'receivable' },
        { action: 'delete', resource: 'flow' },
      ]);
      abacService.hasAnyPermission.mockResolvedValue(false);

      const ctx = makeCtx({ id: 'u-1', role: 'role-1' });
      const body = await denial(guard.canActivate(ctx));
      expect(body.code).toBe(PERMISSION_DENIED);
      expect(body.permissions).toEqual(['receivable:delete', 'flow:delete']);
    });

    // ── Casos adicionais do plano de testes ─────────────────────────────────

    it('permissão com ação "create" não deve dar acesso à ação "delete"', async () => {
      // O guard delega ao AbacService, que valida ação exata.
      // Aqui testamos que o guard passa o resource/action corretos ao service.
      reflector.get
        .mockReturnValueOnce(undefined) // HAS_ANY_PERMISSION_KEY ausente
        .mockReturnValueOnce({ action: 'delete', resource: 'client' }); // HAS_PERMISSION_KEY

      abacService.hasPermission.mockResolvedValue(false); // sem permissão de delete

      const ctx = makeCtx({ id: 'u-1', role: 'role-readonly' });
      await denial(guard.canActivate(ctx));
      expect(abacService.hasPermission).toHaveBeenCalledWith(
        { id: 'u-1', role: 'role-readonly' },
        'delete',
        'client',
      );
    });

    it('deve permitir acesso ao SystemAdmin (isSystemAdmin: true) sem verificar permissões', async () => {
      // O PermissionsGuard delega ao AbacService que retorna true para isSystemAdmin.
      reflector.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ action: 'delete', resource: 'client' });

      abacService.hasPermission.mockResolvedValue(true); // AbacService já lida com isSystemAdmin

      const ctx = makeCtx({ id: 'admin-1', isSystemAdmin: true });
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it('deve bloquear quando nenhuma das permissões múltiplas está presente', async () => {
      reflector.get.mockReturnValueOnce([
        { action: 'create', resource: 'receivable' },
        { action: 'create', resource: 'payable' },
      ]);
      abacService.hasAnyPermission.mockResolvedValue(false);

      const ctx = makeCtx({ id: 'u-readonly', role: 'viewer' });
      await denial(guard.canActivate(ctx));
    });

    it('deve permitir quando ao menos uma das permissões múltiplas está presente (OR)', async () => {
      reflector.get.mockReturnValueOnce([
        { action: 'view', resource: 'receivable' },
        { action: 'view', resource: 'payable' },
      ]);
      abacService.hasAnyPermission.mockResolvedValue(true); // tem ao menos uma

      const ctx = makeCtx({ id: 'u-1', role: 'role-financial' });
      expect(await guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('modo observar (@ObservePermissions)', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => warn.mockRestore());

    it('libera quem não tem a permissão e registra a recusa que faria', async () => {
      reflector.get.mockReturnValueOnce(undefined).mockReturnValueOnce({
        action: 'edit',
        resource: 'sales_settings:seller_profile',
      });
      reflector.getAllAndOverride.mockReturnValue(true);
      abacService.hasPermission.mockResolvedValue(false);

      const ctx = makeCtx(
        { userId: 'u-1', companyId: 'c-1', role: 'role-1' },
        {
          method: 'PATCH',
          route: { path: '/profile/:id' },
          url: '/profile/p-1',
        },
      );

      expect(await guard.canActivate(ctx)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls[0][0] as string;
      expect(line).toContain('PATCH /profile/:id');
      expect(line).toContain('u-1');
      expect(line).toContain('c-1');
      expect(line).toContain('role-1');
      expect(line).toContain('sales_settings:seller_profile:edit');
    });

    it('lê a marca na rota e na classe, com a rota valendo sobre a classe', async () => {
      reflector.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ action: 'view', resource: 'client' });
      reflector.getAllAndOverride.mockReturnValue(true);
      abacService.hasPermission.mockResolvedValue(false);

      const handler = jest.fn();
      const klass = jest.fn();
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({ user: { userId: 'u-1' } }),
        }),
        getHandler: () => handler,
        getClass: () => klass,
      } as unknown as ExecutionContext;

      await guard.canActivate(ctx);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        'observe_permissions',
        [handler, klass],
      );
    });

    it('sem a marca, recusa normalmente e não registra nada', async () => {
      reflector.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ action: 'delete', resource: 'client' });
      reflector.getAllAndOverride.mockReturnValue(undefined);
      abacService.hasPermission.mockResolvedValue(false);

      await denial(guard.canActivate(makeCtx({ userId: 'u-1', role: 'r' })));
      expect(warn).not.toHaveBeenCalled();
    });

    it('com @ObservePermissions(false) na rota, recusa mesmo com a classe observando', async () => {
      reflector.get
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ action: 'delete', resource: 'client' });
      // getAllAndOverride devolve o primeiro valor definido: o da rota (false)
      reflector.getAllAndOverride.mockReturnValue(false);
      abacService.hasPermission.mockResolvedValue(false);

      await denial(guard.canActivate(makeCtx({ userId: 'u-1', role: 'r' })));
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
