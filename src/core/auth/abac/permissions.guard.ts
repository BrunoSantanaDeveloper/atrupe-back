import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AbacService } from './abac.service';
import { HAS_PERMISSION_KEY } from './has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from './has-any-permission.decorator';
import { OBSERVE_PERMISSIONS_KEY } from './observe-permissions.decorator';

type RequiredPermission = { action: string; resource: string };

export const PERMISSION_DENIED = 'PERMISSION_DENIED';
export const PERMISSION_DENIED_MESSAGE =
  'Você não tem permissão para esta ação.';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private reflector: Reflector,
    private abacService: AbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;

    let required: RequiredPermission[];
    let allowed: boolean;

    // --- @HasAnyPermission (OR entre múltiplos recursos) ---
    const anyPermissions = this.reflector.get<RequiredPermission[]>(
      HAS_ANY_PERMISSION_KEY,
      context.getHandler(),
    );

    if (anyPermissions?.length) {
      required = anyPermissions;
      allowed = await this.abacService.hasAnyPermission(user, anyPermissions);
    } else {
      // --- @HasPermission (recurso único) ---
      const requiredPermission = this.reflector.get<RequiredPermission>(
        HAS_PERMISSION_KEY,
        context.getHandler(),
      );

      // Sem decorator → libera qualquer usuário autenticado
      if (!requiredPermission) return true;

      required = [requiredPermission];
      // Delega ao abacService que já trata isAdmin, isSystemAdmin e falta de role
      allowed = await this.abacService.hasPermission(
        user,
        requiredPermission.action,
        requiredPermission.resource,
      );
    }

    if (allowed) return true;

    const permissions = required.map((p) => `${p.resource}:${p.action}`);

    if (this.isObserving(context)) {
      this.logger.warn(
        `[observar] ${request.method} ${request.route?.path ?? request.url} ` +
          `seria recusada: usuário ${user.userId ?? '?'}, ` +
          `empresa ${user.companyId ?? '?'}, cargo ${user.role ?? '-'}, ` +
          `exige ${permissions.join(' ou ')}`,
      );
      return true;
    }

    // Recusar com `false` deixava o 403 padrão do Nest, "Forbidden resource",
    // que chegava em inglês à tela. Com o código, o front mostra a mensagem.
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: PERMISSION_DENIED,
      message: PERMISSION_DENIED_MESSAGE,
      permissions,
    });
  }

  private isObserving(context: ExecutionContext): boolean {
    return !!this.reflector.getAllAndOverride<boolean>(
      OBSERVE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
  }
}
