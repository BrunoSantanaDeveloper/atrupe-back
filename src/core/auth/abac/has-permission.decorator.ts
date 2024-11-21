import { SetMetadata } from '@nestjs/common';

export const HAS_PERMISSION_KEY = 'hasPermission';
export const HasPermission = (action: string, resource: string) =>
  SetMetadata(HAS_PERMISSION_KEY, { action, resource });
