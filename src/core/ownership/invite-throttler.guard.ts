import { Injectable } from '@nestjs/common';
import { ScopedThrottlerGuard } from '../../common/throttler/scoped-throttler.guard';

/**
 * Limite das rotas públicas do convite de transferência.
 *
 * São públicas (quem recebe ainda não tem conta), e duas delas respondem sobre
 * terceiros: se um CNPJ já tem ambiente e se um CPF bate com o quadro
 * societário. O balde é pelo IP real de quem navega — as chamadas chegam pelo
 * servidor do frontend, e pelo IP de conexão todos dividiriam o mesmo limite.
 */
@Injectable()
export class InviteThrottlerGuard extends ScopedThrottlerGuard([
  { name: 'ownership-invite', ttl: 60000, limit: 20 },
]) {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const forwarded = req.headers?.['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : undefined;
    return (
      req.headers?.['x-user-ip'] ||
      req.headers?.['x-real-ip'] ||
      forwardedIp ||
      req.ip
    );
  }
}
