import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from './tenant.guard';
import { PrismaService } from 'nestjs-prisma';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(
  user: any,
  params: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params }),
    }),
    getHandler: () => jest.fn(),
  } as unknown as ExecutionContext;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let reflector: jest.Mocked<Reflector>;
  let prisma: any;

  beforeEach(async () => {
    reflector = { get: jest.fn() } as any;
    prisma = { quotation: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantGuard,
        { provide: Reflector, useValue: reflector },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get<TenantGuard>(TenantGuard);
    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(guard).toBeDefined();
  });

  it('deve permitir quando rota não tem decorator @TenantResource', async () => {
    reflector.get.mockReturnValue(undefined);
    const ctx = makeCtx({ companyId: 'c-1' }, { id: 'res-1' });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(prisma.quotation?.findUnique).not.toHaveBeenCalled();
  });

  it('deve negar quando usuário não tem companyId', async () => {
    reflector.get.mockReturnValue({ model: 'quotation', paramName: 'id' });
    const ctx = makeCtx({ id: 'u-1' }, { id: 'res-1' });
    expect(await guard.canActivate(ctx)).toBe(false);
  });

  it('deve permitir system admin sem checar banco', async () => {
    reflector.get.mockReturnValue({ model: 'quotation', paramName: 'id' });
    const ctx = makeCtx(
      { companyId: 'c-1', isSystemAdmin: true },
      { id: 'res-1' },
    );
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(prisma.quotation?.findUnique).not.toHaveBeenCalled();
  });

  it('deve permitir quando rota não tem parâmetro de ID (listagem)', async () => {
    reflector.get.mockReturnValue({ model: 'quotation', paramName: 'id' });
    const ctx = makeCtx({ companyId: 'c-1', isSystemAdmin: false }, {}); // sem params
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('deve permitir quando recurso pertence à mesma empresa', async () => {
    reflector.get.mockReturnValue({ model: 'quotation', paramName: 'id' });
    prisma.quotation = {
      findUnique: jest.fn().mockResolvedValue({ companyId: 'c-1' }),
    };

    const ctx = makeCtx(
      { companyId: 'c-1', isSystemAdmin: false },
      { id: 'quot-123' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('deve lançar ForbiddenException quando recurso pertence a outra empresa', async () => {
    reflector.get.mockReturnValue({ model: 'quotation', paramName: 'id' });
    prisma.quotation = {
      findUnique: jest.fn().mockResolvedValue({ companyId: 'outra-empresa' }),
    };

    const ctx = makeCtx(
      { companyId: 'c-1', isSystemAdmin: false, userId: 'u-1' },
      { id: 'quot-999' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  describe('com a relação até o dono (via)', () => {
    const config = {
      model: 'payableInstallment',
      paramName: 'installmentId',
      via: 'payable',
    };

    it('lê a empresa pela relação e libera a da mesma empresa', async () => {
      reflector.get.mockReturnValue(config);
      prisma.payableInstallment = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ payable: { companyId: 'c-1' } }),
      };
      const ctx = makeCtx(
        { companyId: 'c-1', isSystemAdmin: false },
        { installmentId: 'parc-1' },
      );

      expect(await guard.canActivate(ctx)).toBe(true);
      expect(prisma.payableInstallment.findUnique).toHaveBeenCalledWith({
        where: { id: 'parc-1' },
        select: { payable: { select: { companyId: true } } },
      });
    });

    it('recusa a parcela de outra empresa', async () => {
      reflector.get.mockReturnValue(config);
      prisma.payableInstallment = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ payable: { companyId: 'outra-empresa' } }),
      };
      const ctx = makeCtx(
        { companyId: 'c-1', isSystemAdmin: false, userId: 'u-1' },
        { installmentId: 'parc-9' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  it('falha fechada com model desconhecido no @TenantResource', async () => {
    reflector.get.mockReturnValue({ model: 'quotaton', paramName: 'id' });
    const ctx = makeCtx(
      { companyId: 'c-1', isSystemAdmin: false },
      { id: 'quot-1' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('erro do banco não libera a requisição', async () => {
    reflector.get.mockReturnValue({ model: 'quotation', paramName: 'id' });
    prisma.quotation = {
      findUnique: jest.fn().mockRejectedValue(new Error('conexão caiu')),
    };
    const ctx = makeCtx(
      { companyId: 'c-1', isSystemAdmin: false },
      { id: 'quot-1' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow('conexão caiu');
  });

  it('deve permitir quando recurso não é encontrado (404 tratado pela service)', async () => {
    reflector.get.mockReturnValue({ model: 'quotation', paramName: 'id' });
    prisma.quotation = { findUnique: jest.fn().mockResolvedValue(null) };

    const ctx = makeCtx(
      { companyId: 'c-1', isSystemAdmin: false },
      { id: 'quot-inexistente' },
    );
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
