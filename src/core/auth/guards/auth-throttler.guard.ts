import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler de autenticação que identifica o cliente pelo IP real do usuário.
 *
 * O login é feito server-side pelo NextAuth (Vercel), então o backend recebe
 * sempre o mesmo IP de egress da Vercel para todos os usuários. Usar o `req.ip`
 * padrão faria todos compartilharem o mesmo bucket de rate limit, bloqueando
 * logins legítimos esporadicamente (429 → CredentialsSignin no frontend).
 *
 * O frontend envia o IP real do usuário no header `x-user-ip`; usamos ele
 * (com fallbacks) para que cada usuário tenha seu próprio limite.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
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
