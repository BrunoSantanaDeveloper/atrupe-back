import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ThrottlerException, ThrottlerLimitDetail } from '@nestjs/throttler';
import { ScopedThrottlerGuard } from './scoped-throttler.guard';

/** Requisições por minuto, por conta, somando todas as rotas. */
export const ACCOUNT_LIMIT_PER_MINUTE = 300;

export const ACCOUNT_LIMIT_MESSAGE =
  'Muitas requisições em pouco tempo. Aguarde um minuto e tente de novo.';

/** O mesmo aviso (por conta) sai no máximo uma vez por janela. */
const WARN_WINDOW_MS = 10 * 60 * 1000;
const MAX_WARN_KEYS = 1_000;

export function accountRateLimitEnforced(): boolean {
  return process.env.ACCOUNT_RATE_LIMIT_ENFORCE === 'true';
}

/**
 * A conta (sub) do token, sem conferir a assinatura: o guard global roda
 * antes do JwtAuthGuard de cada controller, e para contar requisições basta
 * saber de quem são. A autenticação de verdade vem depois; um token forjado
 * conta numa conta inventada e é recusado no login da rota.
 */
export function accountOf(req: Record<string, any>): string | null {
  const header = req?.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const payload = header.slice('Bearer '.length).split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof claims?.sub === 'string' && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * Limite de requisições por conta e por minuto, em todas as rotas
 * autenticadas. As rotas sem token (login, cadastro, webhooks) têm os
 * limites próprios e ficam de fora; o IP também não serve aqui, porque o
 * front fala com a API pelo servidor da Vercel.
 *
 * Por padrão só observa: registra no log a conta que passa do limite, sem
 * recusar. O número precisa de calibragem com o uso real (uma tela de painel
 * dispara dezenas de chamadas). Com ACCOUNT_RATE_LIMIT_ENFORCE=true, recusa
 * com 429.
 */
@Injectable()
export class AccountThrottlerGuard extends ScopedThrottlerGuard([
  { name: 'account', ttl: 60_000, limit: ACCOUNT_LIMIT_PER_MINUTE },
]) {
  private readonly logger = new Logger(AccountThrottlerGuard.name);
  private readonly warnedAt = new Map<string, number>();

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return !accountOf(context.switchToHttp().getRequest());
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return accountOf(req) ?? req.ip;
  }

  // Uma conta só para todas as rotas: a chave padrão conta por rota
  protected generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `${name}:${tracker}`;
  }

  protected async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    if (accountRateLimitEnforced()) {
      throw new ThrottlerException(ACCOUNT_LIMIT_MESSAGE);
    }

    const now = Date.now();
    const last = this.warnedAt.get(detail.tracker);
    if (last !== undefined && now - last < WARN_WINDOW_MS) return;
    if (this.warnedAt.size >= MAX_WARN_KEYS) this.warnedAt.clear();
    this.warnedAt.set(detail.tracker, now);
    this.logger.warn(
      `[observar] conta ${detail.tracker} passou de ${detail.limit} requisições por minuto (${detail.totalHits})`,
    );
  }
}
