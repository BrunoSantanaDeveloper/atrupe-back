import { Injectable } from '@nestjs/common';

import { ScopedThrottlerGuard } from '../../../common/throttler/scoped-throttler.guard';

/**
 * Throttler dos endpoints publicos de usuario (cadastro, recuperacao de senha,
 * verificacao de e-mail). O teto de 3/min e o padrao; alguns handlers ajustam o
 * valor via `@Throttle({ public: ... })` no controller.
 */
@Injectable()
export class PublicThrottlerGuard extends ScopedThrottlerGuard([
  { name: 'public', ttl: 60000, limit: 3 },
]) {}
