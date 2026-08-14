import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureGuard, REQUIRED_FEATURE_KEY } from './feature.guard';
import { PlanControlService } from '../plan-control.service';

/**
 * O FeatureGuard lê a metadata REQUIRED_FEATURE_KEY do handler e, na ausência
 * dela, do controller — permitindo declarar @RequiresFeature uma única vez na
 * classe (como no ProductFiscalController, travado em `nota_fiscal`).
 */

const HANDLER = () => undefined;
class FakeController {}

function makeCtx(user: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => HANDLER,
    getClass: () => FakeController,
  } as unknown as ExecutionContext;
}

describe('FeatureGuard', () => {
  let guard: FeatureGuard;
  let reflector: jest.Mocked<Reflector>;
  let planControlService: jest.Mocked<PlanControlService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
        {
          provide: PlanControlService,
          useValue: { enforceFeature: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get<FeatureGuard>(FeatureGuard);
    reflector = module.get(Reflector);
    planControlService = module.get(PlanControlService);

    jest.clearAllMocks();
  });

  it('deve estar definido', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('deve permitir quando a rota não exige feature', async () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);

      const result = await guard.canActivate(makeCtx({ companyId: 'c-1' }));

      expect(result).toBe(true);
      expect(planControlService.enforceFeature).not.toHaveBeenCalled();
    });

    it('deve consultar handler e controller, nessa ordem de precedência', async () => {
      reflector.getAllAndOverride.mockReturnValue('nota_fiscal');
      planControlService.enforceFeature.mockResolvedValue(undefined);

      await guard.canActivate(makeCtx({ companyId: 'c-1' }));

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        REQUIRED_FEATURE_KEY,
        [HANDLER, FakeController],
      );
    });

    it('deve permitir quando a empresa possui a feature', async () => {
      reflector.getAllAndOverride.mockReturnValue('nota_fiscal');
      planControlService.enforceFeature.mockResolvedValue(undefined);

      const result = await guard.canActivate(makeCtx({ companyId: 'c-1' }));

      expect(result).toBe(true);
      expect(planControlService.enforceFeature).toHaveBeenCalledWith(
        'c-1',
        'nota_fiscal',
      );
    });

    it('deve negar quando não há companyId no token', async () => {
      reflector.getAllAndOverride.mockReturnValue('nota_fiscal');

      const result = await guard.canActivate(makeCtx({ id: 'u-1' }));

      expect(result).toBe(false);
      expect(planControlService.enforceFeature).not.toHaveBeenCalled();
    });

    it('deve propagar a mensagem do plano quando a feature não está contratada', async () => {
      reflector.getAllAndOverride.mockReturnValue('nota_fiscal');
      planControlService.enforceFeature.mockRejectedValue(
        new ForbiddenException('Feature não disponível no plano Lite.'),
      );

      await expect(
        guard.canActivate(makeCtx({ companyId: 'c-1' })),
      ).rejects.toThrow('Feature não disponível no plano Lite.');
    });

    it('deve negar sem vazar erro inesperado da consulta de plano', async () => {
      reflector.getAllAndOverride.mockReturnValue('nota_fiscal');
      planControlService.enforceFeature.mockRejectedValue(
        new Error('conexão perdida'),
      );

      const result = await guard.canActivate(makeCtx({ companyId: 'c-1' }));

      expect(result).toBe(false);
    });
  });
});
