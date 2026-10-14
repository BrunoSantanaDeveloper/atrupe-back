import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';
import {
  OBSERVE_FEATURE_KEY,
  isObservingNow,
} from '../plan/decorators/observe-feature.decorator';
import { RequiresFiscalModule } from './requires-fiscal-module.decorator';

/**
 * A emissão de nota exige o módulo Nota Fiscal. Observa até a data de
 * FISCAL_MODULE_ENFORCE_FROM e recusa a partir dela (PO, 14/10/2026).
 */
describe('RequiresFiscalModule', () => {
  class Emissao {
    @RequiresFiscalModule()
    emit() {}
  }
  const handler = Emissao.prototype.emit;

  it('passa a rota pelo FeatureGuard com o módulo nota_fiscal', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      FeatureGuard,
    ]);
    expect(Reflect.getMetadata(REQUIRED_FEATURE_KEY, handler)).toBe(
      'nota_fiscal',
    );
  });

  it('observa até a data de FISCAL_MODULE_ENFORCE_FROM e recusa depois', () => {
    const setting = Reflect.getMetadata(OBSERVE_FEATURE_KEY, handler);
    expect(setting).toEqual({ untilEnv: 'FISCAL_MODULE_ENFORCE_FROM' });

    const previous = process.env.FISCAL_MODULE_ENFORCE_FROM;
    try {
      // Sem a data, quem emite sem o módulo continua emitindo
      delete process.env.FISCAL_MODULE_ENFORCE_FROM;
      expect(isObservingNow(setting)).toBe(true);
      process.env.FISCAL_MODULE_ENFORCE_FROM = '2026-11-14';
      expect(isObservingNow(setting, new Date('2026-11-13T12:00:00Z'))).toBe(
        true,
      );
      expect(isObservingNow(setting, new Date('2026-11-14T12:00:00Z'))).toBe(
        false,
      );
    } finally {
      if (previous === undefined) delete process.env.FISCAL_MODULE_ENFORCE_FROM;
      else process.env.FISCAL_MODULE_ENFORCE_FROM = previous;
    }
  });
});
