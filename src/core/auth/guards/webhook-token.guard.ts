import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { isDeclaredTestEnv } from 'src/shared/utils/app-env';

/** Comparação em tempo constante: o tempo de resposta não revela o token. */
function sameToken(received: string, expected: string): boolean {
  const a = Buffer.from(String(received));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class WebhookTokenGuard implements CanActivate {
  private readonly logger = new Logger(WebhookTokenGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const expectedToken = this.configService.get<string>(
      'WEBHOOK_ACCESS_TOKEN',
    );

    // Sem token configurado, só passa em ambiente de teste declarado
    // (APP_ENV definida e diferente de production). Em produção recusa: o
    // corpo do webhook ativa, desbloqueia e cancela assinaturas pelos ids
    // do Asaas, e sem o token qualquer um chamava a rota.
    if (!expectedToken) {
      if (!isDeclaredTestEnv()) {
        this.logger.error(
          'WEBHOOK_ACCESS_TOKEN não configurado: webhook recusado. Defina o token na API e no painel do Asaas.',
        );
        throw new ForbiddenException('Webhook token not configured');
      }
      this.logger.warn(
        'WEBHOOK_ACCESS_TOKEN not configured — webhook endpoint is unprotected',
      );
      return true;
    }

    const receivedToken = request.headers['asaas-access-token'] as string;

    if (!receivedToken || !sameToken(receivedToken, expectedToken)) {
      this.logger.warn(`Webhook rejected: invalid token from ${request.ip}`);
      throw new ForbiddenException('Invalid webhook token');
    }

    return true;
  }
}
