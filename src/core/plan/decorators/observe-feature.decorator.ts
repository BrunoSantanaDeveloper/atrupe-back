import { SetMetadata } from '@nestjs/common';

export const OBSERVE_FEATURE_KEY = 'observe_feature';

/**
 * `true` observa sempre; `{ untilEnv }` observa até a data (AAAA-MM-DD) da
 * variável de ambiente e recusa a partir dela. Sem a variável, observa.
 */
export type ObserveSetting = boolean | { untilEnv: string };

/**
 * Modo "observar" do FeatureGuard: a empresa cujo plano não tem o recurso
 * exigido por @RequiresFeature continua passando, e o guard registra no log a
 * recusa que faria. Serve para ligar o recurso numa rota que hoje está aberta
 * sem cortar quem já usa: o log mostra quais empresas precisam contratar
 * antes de tirar o decorator.
 *
 * Vale na classe ou na rota; na rota, `@ObserveFeature(false)` volta a
 * recusar dentro de um controller que observa. Com `{ untilEnv }`, a recusa
 * começa na data marcada no ambiente, sem deploy.
 */
export const ObserveFeature = (enabled: ObserveSetting = true) =>
  SetMetadata(OBSERVE_FEATURE_KEY, enabled);

/** Se a rota ainda observa agora (a data de corte não chegou). */
export const isObservingNow = (
  setting: ObserveSetting | undefined,
  now = new Date(),
) => {
  if (!setting) return false;
  if (setting === true) return true;
  const raw = process.env[setting.untilEnv]?.trim();
  if (!raw) return true;
  const from = new Date(raw);
  // Data inválida não recusa ninguém: o log avisa e segue observando
  return Number.isNaN(from.getTime()) || now < from;
};
