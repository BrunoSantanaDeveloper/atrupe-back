import { Injectable } from '@nestjs/common';
import { ScopedThrottlerGuard } from '../../../common/throttler/scoped-throttler.guard';

/**
 * Limite das consultas da contratação (CNPJ e conferência do representante).
 *
 * A conferência do representante responde se um CPF bate com o quadro
 * societário de uma empresa: sem limite, vira um oráculo para descobrir os
 * dígitos escondidos da máscara. O balde é por USUÁRIO, não por IP — as
 * chamadas chegam pelo servidor do frontend, e por IP todos dividiriam o
 * mesmo limite.
 */
@Injectable()
export class CheckoutThrottlerGuard extends ScopedThrottlerGuard([
  { name: 'checkout', ttl: 60000, limit: 10 },
]) {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.userId ? `user:${req.user.userId}` : req.ip;
  }
}
