import { SetMetadata } from '@nestjs/common';

export const HAS_ANY_PERMISSION_KEY = 'has_any_permission';

/**
 * Decorator que exige que o usuário tenha PELO MENOS UMA das permissões
 * listadas (lógica OR). Ideal para endpoints acessíveis por múltiplos perfis.
 *
 * @example
 * // Aceita quem tem financial:flow:edit OU financial:receivable:edit
 * @HasAnyPermission(
 *   { action: 'edit', resource: 'financial:flow' },
 *   { action: 'edit', resource: 'financial:receivable' },
 * )
 */
export const HasAnyPermission = (
  ...permissions: { action: string; resource: string }[]
) => SetMetadata(HAS_ANY_PERMISSION_KEY, permissions);
