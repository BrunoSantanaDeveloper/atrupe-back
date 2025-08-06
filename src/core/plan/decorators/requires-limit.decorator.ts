import { SetMetadata } from '@nestjs/common';
import { REQUIRED_LIMIT_KEY, LimitConfig } from '../guards/limit.guard';

/**
 * Decorator para verificar limite antes de executar ação
 * @param key - chave do limite (ex: 'max_users', 'max_products')
 * @param action - tipo de ação ('create' para simular +1, 'check' para apenas verificar)
 */
export const RequiresLimit = (
  key: string,
  action: 'create' | 'check' = 'create',
) => SetMetadata(REQUIRED_LIMIT_KEY, { key, action } as LimitConfig);
