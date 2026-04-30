import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AbacService } from './abac.service';
import { HAS_PERMISSION_KEY } from './has-permission.decorator';
import { HAS_ANY_PERMISSION_KEY } from './has-any-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private abacService: AbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;

    // --- @HasAnyPermission (OR entre múltiplos recursos) ---
    const anyPermissions = this.reflector.get<
      { action: string; resource: string }[]
    >(HAS_ANY_PERMISSION_KEY, context.getHandler());

    if (anyPermissions?.length) {
      return this.abacService.hasAnyPermission(user, anyPermissions);
    }

    // --- @HasPermission (recurso único) ---
    const requiredPermission = this.reflector.get<{
      action: string;
      resource: string;
    }>(HAS_PERMISSION_KEY, context.getHandler());

    // Sem decorator → libera qualquer usuário autenticado
    if (!requiredPermission) return true;

    // Delega ao abacService que já trata isAdmin, isSystemAdmin e falta de role
    return this.abacService.hasPermission(
      user,
      requiredPermission.action,
      requiredPermission.resource,
    );
  }
}
