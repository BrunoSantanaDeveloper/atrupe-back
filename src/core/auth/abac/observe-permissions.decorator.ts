import { SetMetadata } from '@nestjs/common';

export const OBSERVE_PERMISSIONS_KEY = 'observe_permissions';

/**
 * Modo "observar" do PermissionsGuard: quem não tem a permissão exigida por
 * @HasPermission ou @HasAnyPermission continua passando, e o guard registra no
 * log a recusa que faria. Serve para ligar a permissão numa rota que hoje
 * está aberta sem quebrar cargos que dependem dela: o log mostra quais cargos
 * precisam de ajuste antes de tirar o decorator.
 *
 * Vale na classe (todas as rotas do controller) ou na rota; na rota,
 * `@ObservePermissions(false)` volta a recusar dentro de um controller que
 * observa.
 */
export const ObservePermissions = (enabled = true) =>
  SetMetadata(OBSERVE_PERMISSIONS_KEY, enabled);
