import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'nestjs-prisma';
import {
  TENANT_RESOURCE_KEY,
  TenantResourceConfig,
} from './tenant-resource.decorator';

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
    const tenantConfig = this.reflector.get<TenantResourceConfig>(
      TENANT_RESOURCE_KEY,
      context.getHandler(),
    );

    if (!tenantConfig) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.companyId) return false;

    // System admins bypass tenant validation
    if (user.isSystemAdmin) return true;

    const resourceId = request.params[tenantConfig.paramName];
    if (!resourceId) return true;

    // Falha fechada. Antes, nome de model errado, model sem companyId ou
    // erro do banco liberavam a requisição: a rota ficava aberta a outras
    // empresas sem aviso. O nome e o companyId de cada @TenantResource são
    // conferidos por tenant-resource.spec.ts; erro do banco sobe como 500.
    const delegate = (this.prisma as any)[tenantConfig.model];
    if (typeof delegate?.findUnique !== 'function') {
      this.logger.error(
        `TenantGuard: model desconhecido "${tenantConfig.model}" no @TenantResource`,
      );
      throw new ForbiddenException('Acesso negado.');
    }

    // Sem companyId no model, a empresa vem do dono pela relação (via)
    const { via } = tenantConfig;
    const resource = await delegate.findUnique({
      where: { id: resourceId },
      select: via
        ? { [via]: { select: { companyId: true } } }
        : { companyId: true },
    });

    if (!resource) {
      // Let the service handle 404
      return true;
    }

    const ownerCompanyId = via ? resource[via]?.companyId : resource.companyId;
    if (ownerCompanyId !== user.companyId) {
      this.logger.warn(
        `Tenant violation: user ${user.userId} (company ${user.companyId}) tried to access ${tenantConfig.model} ${resourceId} (company ${ownerCompanyId})`,
      );
      throw new ForbiddenException('Acesso negado.');
    }

    return true;
  }
}
