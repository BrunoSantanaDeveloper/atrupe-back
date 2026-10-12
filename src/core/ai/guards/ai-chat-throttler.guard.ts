import { Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ScopedThrottlerGuard } from '../../../common/throttler/scoped-throttler.guard';

export const AI_CHAT_LIMIT_MESSAGE =
  'Muitas mensagens para o assistente em pouco tempo. Aguarde um pouco e tente de novo.';

/**
 * Limite do chat de IA, por usuário: cada mensagem chama o modelo e custa.
 * Sem ele, um usuário (ou um script com o token dele) mandava mensagens sem
 * limite. Roda depois do login, então identifica pelo usuário, não pelo IP
 * (o front fala com a API pelo servidor da Vercel, um IP só para todos).
 */
@Injectable()
export class AiChatThrottlerGuard extends ScopedThrottlerGuard([
  { name: 'ai-minute', ttl: 60_000, limit: 20 },
  { name: 'ai-hour', ttl: 3_600_000, limit: 200 },
]) {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.userId ?? req.ip;
  }

  protected async throwThrottlingException(): Promise<void> {
    throw new ThrottlerException(AI_CHAT_LIMIT_MESSAGE);
  }
}
