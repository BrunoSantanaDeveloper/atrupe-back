import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureGuard, REQUIRED_FEATURE_KEY } from './feature.guard';
import { PlanControlService } from '../plan-control.service';
import { OBSERVE_FEATURE_KEY } from '../decorators/observe-feature.decorator';

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
      getRequest: () => ({
        user,
        method: 'POST',
        route: { path: '/fiscal/nfe/emit' },
      }),
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

  // O recurso exigido pela rota e, se for o caso, o modo observar
  const requires = (feature: string | undefined, observe = false) =>
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === REQUIRED_FEATURE_KEY
        ? feature
        : key === OBSERVE_FEATURE_KEY
          ? observe
          : undefined,
    );

  it('deve estar definido', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('deve permitir quando a rota não exige feature', async () => {
      requires(undefined);

      const result = await guard.canActivate(makeCtx({ companyId: 'c-1' }));

      expect(result).toBe(true);
      expect(planControlService.enforceFeature).not.toHaveBeenCalled();
    });

    it('deve consultar handler e controller, nessa ordem de precedência', async () => {
      requires('nota_fiscal');
      planControlService.enforceFeature.mockResolvedValue(undefined);

      await guard.canActivate(makeCtx({ companyId: 'c-1' }));

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        REQUIRED_FEATURE_KEY,
        [HANDLER, FakeController],
      );
    });

    it('deve permitir quando a empresa possui a feature', async () => {
      requires('nota_fiscal');
      planControlService.enforceFeature.mockResolvedValue(undefined);

      const result = await guard.canActivate(makeCtx({ companyId: 'c-1' }));

      expect(result).toBe(true);
      expect(planControlService.enforceFeature).toHaveBeenCalledWith(
        'c-1',
        'nota_fiscal',
      );
    });

    it('deve negar quando não há companyId no token', async () => {
      requires('nota_fiscal');

      const result = await guard.canActivate(makeCtx({ id: 'u-1' }));

      expect(result).toBe(false);
      expect(planControlService.enforceFeature).not.toHaveBeenCalled();
    });

    it('deve propagar a mensagem do plano quando a feature não está contratada', async () => {
      requires('nota_fiscal');
      planControlService.enforceFeature.mockRejectedValue(
        new ForbiddenException('Feature não disponível no plano Lite.'),
      );

      await expect(
        guard.canActivate(makeCtx({ companyId: 'c-1' })),
      ).rejects.toThrow('Feature não disponível no plano Lite.');
    });

    it('deve negar sem vazar erro inesperado da consulta de plano', async () => {
      requires('nota_fiscal');
      planControlService.enforceFeature.mockRejectedValue(
        new Error('conexão perdida'),
      );

      const result = await guard.canActivate(makeCtx({ companyId: 'c-1' }));

      expect(result).toBe(false);
    });
  });

  // A emissão de nota passou a exigir o módulo nota_fiscal, observando:
  // quem já emite sem o módulo continua emitindo e o log mostra quem é
  describe('observando (@ObserveFeature)', () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => warn.mockRestore());

    it('empresa sem o recurso passa, e a recusa vai para o log', async () => {
      requires('nota_fiscal', true);
      planControlService.enforceFeature.mockRejectedValue(
        new ForbiddenException(
          'O recurso "Nota Fiscal" é um módulo contratado à parte.',
        ),
      );

      const result = await guard.canActivate(
        makeCtx({ companyId: 'c-1', userId: 'u-1' }),
      );

      expect(result).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        '[observar] POST /fiscal/nfe/emit seria recusada: empresa c-1, ' +
          'usuário u-1, exige o recurso nota_fiscal (o plano não tem o recurso)',
      );
    });

    it('o mesmo aviso sai uma vez por janela', async () => {
      requires('nota_fiscal', true);
      planControlService.enforceFeature.mockRejectedValue(
        new ForbiddenException('sem o módulo'),
      );

      await guard.canActivate(makeCtx({ companyId: 'c-1' }));
      await guard.canActivate(makeCtx({ companyId: 'c-1' }));
      await guard.canActivate(makeCtx({ companyId: 'c-2' }));

      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('empresa com o recurso passa sem aviso', async () => {
      requires('nota_fiscal', true);
      planControlService.enforceFeature.mockResolvedValue(undefined);

      expect(await guard.canActivate(makeCtx({ companyId: 'c-1' }))).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it('falha na consulta do plano não recusa', async () => {
      requires('nota_fiscal', true);
      planControlService.enforceFeature.mockRejectedValue(
        new Error('conexão perdida'),
      );

      expect(await guard.canActivate(makeCtx({ companyId: 'c-1' }))).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('(plano não conferido: conexão perdida)'),
      );
    });

    it('sessão sem empresa não recusa', async () => {
      requires('nota_fiscal', true);

      expect(await guard.canActivate(makeCtx({ id: 'u-1' }))).toBe(true);
      expect(planControlService.enforceFeature).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('(sessão sem empresa)'),
      );
    });
  });
});
