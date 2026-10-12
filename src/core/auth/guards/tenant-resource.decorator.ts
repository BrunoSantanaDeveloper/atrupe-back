import { SetMetadata } from '@nestjs/common';

export const TENANT_RESOURCE_KEY = 'tenantResource';

export interface TenantResourceConfig {
  model: string;
  paramName: string;
  /** Relação até o registro que tem companyId, quando o model não tem */
  via?: string;
}

/**
 * Decorator that marks an endpoint as requiring tenant validation.
 * The guard will verify that the resource with the given ID param
 * belongs to the requesting user's company.
 *
 * @param model - Prisma model name (e.g., 'payable', 'receivable', 'client')
 * @param paramName - Route param name that contains the resource ID (default: 'id')
 * @param via - Relação até o dono, quando o model não tem companyId: a parcela
 *   é da empresa da conta (`@TenantResource('payableInstallment',
 *   'installmentId', 'payable')`)
 */
export const TenantResource = (model: string, paramName = 'id', via?: string) =>
  SetMetadata(TENANT_RESOURCE_KEY, {
    model,
    paramName,
    via,
  } satisfies TenantResourceConfig);
