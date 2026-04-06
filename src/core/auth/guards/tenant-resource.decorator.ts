import { SetMetadata } from '@nestjs/common';

export const TENANT_RESOURCE_KEY = 'tenantResource';

/**
 * Decorator that marks an endpoint as requiring tenant validation.
 * The guard will verify that the resource with the given ID param
 * belongs to the requesting user's company.
 *
 * @param model - Prisma model name (e.g., 'payable', 'receivable', 'client')
 * @param paramName - Route param name that contains the resource ID (default: 'id')
 */
export const TenantResource = (model: string, paramName = 'id') =>
  SetMetadata(TENANT_RESOURCE_KEY, { model, paramName });
