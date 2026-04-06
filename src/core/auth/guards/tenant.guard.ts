import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'nestjs-prisma';
import { TENANT_RESOURCE_KEY } from './tenant-resource.decorator';

/**
 * Guard that validates cross-tenant access.
 * When @TenantResource(model, paramName) is applied to an endpoint,
 * this guard verifies the resource belongs to the user's company.
 *
 * Skips validation for:
 * - System admins
 * - Endpoints without @TenantResource decorator
 * - Requests without an ID param (list endpoints)
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const tenantConfig = this.reflector.get<{
      model: string;
      paramName: string;
    }>(TENANT_RESOURCE_KEY, context.getHandler());

    if (!tenantConfig) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.companyId) return false;

    // System admins bypass tenant validation
    if (user.isSystemAdmin) return true;

    const resourceId = request.params[tenantConfig.paramName];
    if (!resourceId) return true;

    try {
      const resource = await (this.prisma[tenantConfig.model] as any).findUnique({
        where: { id: resourceId },
        select: { companyId: true },
      });

      if (!resource) {
        // Let the service handle 404
        return true;
      }

      if (resource.companyId !== user.companyId) {
        this.logger.warn(
          `Tenant violation: user ${user.userId} (company ${user.companyId}) tried to access ${tenantConfig.model} ${resourceId} (company ${resource.companyId})`,
        );
        throw new ForbiddenException('Acesso negado.');
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      // Model might not have companyId or doesn't exist
      this.logger.warn(
        `TenantGuard: Could not validate ${tenantConfig.model}.${resourceId}: ${error.message}`,
      );
      return true;
    }
  }
}
