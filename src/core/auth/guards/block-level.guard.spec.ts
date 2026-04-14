import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BlockLevelGuard } from './block-level.guard';
import { PrismaService } from 'src/config/prisma/prisma.service';

describe('BlockLevelGuard', () => {
  let guard: BlockLevelGuard;

  const mockPrismaService = {
    company: {
      findUnique: jest.fn(),
    },
  };

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const createMockExecutionContext = (user: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockLevelGuard,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<BlockLevelGuard>(BlockLevelGuard);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should allow access when no user is authenticated', async () => {
      const context = createMockExecutionContext(null);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockPrismaService.company.findUnique).not.toHaveBeenCalled();
    });

    it('should allow access when user has no companyId', async () => {
      const context = createMockExecutionContext({ userId: '123' });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockPrismaService.company.findUnique).not.toHaveBeenCalled();
    });

    it('should allow access for system admin regardless of block level', async () => {
      const context = createMockExecutionContext({
        companyId: 'company-1',
        isSystemAdmin: true,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockPrismaService.company.findUnique).not.toHaveBeenCalled();
    });

    it('should allow access when company has no block (NONE)', async () => {
      const context = createMockExecutionContext({ companyId: 'company-1' });

      mockPrismaService.company.findUnique.mockResolvedValue({
        blockLevel: 'NONE',
        blockReason: null,
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should throw ForbiddenException when company is FULL blocked', async () => {
      const context = createMockExecutionContext({ companyId: 'company-1' });

      mockPrismaService.company.findUnique.mockResolvedValue({
        blockLevel: 'FULL',
        blockReason: '10 dias de atraso',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );

      try {
        await guard.canActivate(context);
      } catch (error) {
        expect(error.response.code).toBe('COMPANY_BLOCKED_FULL');
        expect(error.response.blockLevel).toBe('FULL');
      }
    });

    it('should allow access for PARTIAL block on regular routes', async () => {
      const context = createMockExecutionContext({ companyId: 'company-1' });

      mockPrismaService.company.findUnique.mockResolvedValue({
        blockLevel: 'PARTIAL',
        blockReason: '3 dias de atraso',
      });
      mockReflector.getAllAndOverride.mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should throw ForbiddenException for PARTIAL block on @RequireUnblocked routes', async () => {
      const context = createMockExecutionContext({ companyId: 'company-1' });

      mockPrismaService.company.findUnique.mockResolvedValue({
        blockLevel: 'PARTIAL',
        blockReason: '3 dias de atraso',
      });
      mockReflector.getAllAndOverride.mockReturnValue(true);

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );

      try {
        await guard.canActivate(context);
      } catch (error) {
        expect(error.response.code).toBe('FEATURE_BLOCKED');
        expect(error.response.blockLevel).toBe('PARTIAL');
      }
    });

    it('should allow access when company not found', async () => {
      const context = createMockExecutionContext({ companyId: 'company-1' });

      mockPrismaService.company.findUnique.mockResolvedValue(null);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});
