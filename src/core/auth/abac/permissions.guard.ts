import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AbacService } from './abac.service';
import { HAS_PERMISSION_KEY } from './has-permission.decorator';

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

    const requiredPermission = this.reflector.get<{
      action: string;
      resource: string;
    }>(HAS_PERMISSION_KEY, context.getHandler());

    // Se a rota não exige permissão específica, libera qualquer usuário autenticado
    if (!requiredPermission) return true;

    // Delega ao abacService que já trata isAdmin, isSystemAdmin e falta de role
    return this.abacService.hasPermission(
      user,
      requiredPermission.action,
      requiredPermission.resource,
    );
  }
}
