import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  FeatureGuard,
  REQUIRED_FEATURE_KEY,
} from '../plan/guards/feature.guard';
import { OBSERVE_FEATURE_KEY } from '../plan/decorators/observe-feature.decorator';
import { RequiresFiscalModule } from './requires-fiscal-module.decorator';

/**
 * A emissão de nota exige o módulo Nota Fiscal e, por enquanto, só observa.
 * Ligar a recusa é tirar o ObserveFeature() do decorator e trocar o último
 * teste.
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

  it('só observa: quem emite sem o módulo continua emitindo', () => {
    expect(Reflect.getMetadata(OBSERVE_FEATURE_KEY, handler)).toBe(true);
  });
});
