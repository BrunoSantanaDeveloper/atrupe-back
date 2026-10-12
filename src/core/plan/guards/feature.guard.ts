import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanControlService } from '../plan-control.service';
import { OBSERVE_FEATURE_KEY } from '../decorators/observe-feature.decorator';

export const REQUIRED_FEATURE_KEY = 'requiredFeature';

/** O mesmo aviso (rota, empresa e motivo) sai no máximo uma vez por janela. */
const WARN_WINDOW_MS = 10 * 60 * 1000;
const MAX_WARN_KEYS = 1_000;

@Injectable()
export class FeatureGuard implements CanActivate {
  private readonly logger = new Logger(FeatureGuard.name);
  private readonly warnedAt = new Map<string, number>();

  constructor(
    private reflector: Reflector,
    private planControlService: PlanControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Handler tem precedência sobre o controller, permitindo declarar a feature
    // uma única vez na classe e sobrescrever em endpoints específicos
    const requiredFeature = this.reflector.getAllAndOverride<string | string[]>(
      REQUIRED_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature || requiredFeature.length === 0) {
      return true; // Se não há feature requerida, permite acesso
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const observing = this.isObserving(context);

    if (!user?.companyId) {
      if (!observing) return false;
      this.warnOnce(request, requiredFeature, 'sessão sem empresa');
      return true;
    }

    try {
      await this.planControlService.enforceFeature(
        user.companyId,
        requiredFeature,
      );
      return true;
    } catch (error) {
      if (observing) {
        this.warnOnce(
          request,
          requiredFeature,
          error instanceof ForbiddenException
            ? 'o plano não tem o recurso'
            : `plano não conferido: ${error?.message ?? error}`,
        );
        return true;
      }
      // Propaga o 403 do plano (code FEATURE_NOT_AVAILABLE, com o nome do
      // recurso) em vez do 403 genérico do Nest; qualquer outra falha nega.
      if (error instanceof ForbiddenException) {
        throw error;
      }
      return false;
    }
  }

  private isObserving(context: ExecutionContext): boolean {
    return !!this.reflector.getAllAndOverride<boolean>(OBSERVE_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  private warnOnce(request: any, feature: string | string[], reason: string) {
    const route = `${request.method} ${request.route?.path ?? request.url}`;
    const companyId = request.user?.companyId ?? '?';
    const key = `${route} ${companyId} ${reason}`;

    const now = Date.now();
    const last = this.warnedAt.get(key);
    if (last !== undefined && now - last < WARN_WINDOW_MS) return;
    if (this.warnedAt.size >= MAX_WARN_KEYS) this.warnedAt.clear();
    this.warnedAt.set(key, now);

    const features = Array.isArray(feature) ? feature.join(' ou ') : feature;
    this.logger.warn(
      `[observar] ${route} seria recusada: empresa ${companyId}, ` +
        `usuário ${request.user?.userId ?? '?'}, exige o recurso ${features} ` +
        `(${reason})`,
    );
  }
}
