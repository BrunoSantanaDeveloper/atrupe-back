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

    const permissions = this.reflector.get<{
      action: string;
      resource: string;
    }>(HAS_PERMISSION_KEY, context.getHandler());

    if (!permissions || !user) return false;

    return await this.abacService.hasPermission(
      user,
      permissions.action,
      permissions.resource,
    );
  }
}
