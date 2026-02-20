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

    if (!user || !user.role) return false;

    const requiredPermission = this.reflector.get<{
      action: string;
      resource: string;
    }>(HAS_PERMISSION_KEY, context.getHandler());

    if (!requiredPermission) return true;

    const userPermissions = await this.abacService.getPermissionsByRole(
      user.role,
    );
    if (userPermissions.isAdmin) {
      return true;
    }
    if (!userPermissions || userPermissions.permissions.length === 0)
      return false;

    const permissionString = `${requiredPermission.resource}:${requiredPermission.action}`;

    return userPermissions.permissions.includes(permissionString);
  }
}
