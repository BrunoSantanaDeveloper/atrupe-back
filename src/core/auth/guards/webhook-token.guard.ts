import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WebhookTokenGuard implements CanActivate {
  private readonly logger = new Logger(WebhookTokenGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const expectedToken = this.configService.get<string>(
      'WEBHOOK_ACCESS_TOKEN',
    );

    // If no token configured, allow (dev mode) but log warning
    if (!expectedToken) {
      this.logger.warn(
        'WEBHOOK_ACCESS_TOKEN not configured — webhook endpoint is unprotected',
      );
      return true;
    }

    const receivedToken = request.headers['asaas-access-token'] as string;

    if (!receivedToken || receivedToken !== expectedToken) {
      this.logger.warn(
        `Webhook rejected: invalid token from ${request.ip}`,
      );
      throw new ForbiddenException('Invalid webhook token');
    }

    return true;
  }
}
