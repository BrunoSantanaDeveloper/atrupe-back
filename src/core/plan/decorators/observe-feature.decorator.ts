import { SetMetadata } from '@nestjs/common';

export const OBSERVE_FEATURE_KEY = 'observe_feature';

/**
 * Modo "observar" do FeatureGuard: a empresa cujo plano não tem o recurso
 * exigido por @RequiresFeature continua passando, e o guard registra no log a
 * recusa que faria. Serve para ligar o recurso numa rota que hoje está aberta
 * sem cortar quem já usa: o log mostra quais empresas precisam contratar
 * antes de tirar o decorator.
 *
 * Vale na classe ou na rota; na rota, `@ObserveFeature(false)` volta a
 * recusar dentro de um controller que observa.
 */
export const ObserveFeature = (enabled = true) =>
  SetMetadata(OBSERVE_FEATURE_KEY, enabled);
