import { Injectable } from '@nestjs/common';

import { ScopedThrottlerGuard } from '../../../../common/throttler/scoped-throttler.guard';

/**
 * Throttler dos endpoints fiscais, identificado pela empresa autenticada.
 *
 * Eventos fiscais custam chamadas pagas ao provedor e seguram conexao do pool:
 * sem teto, um unico tenant consegue degradar todos os outros. As leituras que
 * so tocam o banco ficam de fora via `@SkipThrottle()`.
 *
 * As chamadas chegam por server actions do Next.js hospedadas na Vercel, entao
 * o backend recebe sempre o mesmo IP de egress. Com o `req.ip` padrao todas as
 * empresas dividiriam um unico bucket e o teto de uma delas derrubaria a
 * plataforma inteira com 429. O JwtAuthGuard roda antes deste guard, entao
 * `req.user` ja esta preenchido.
 */
@Injectable()
export class FiscalThrottlerGuard extends ScopedThrottlerGuard([
  { name: 'default', ttl: 60000, limit: 10 },
]) {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const companyId = req.user?.companyId;
    return companyId ? `company:${companyId}` : req.ip;
  }
}
