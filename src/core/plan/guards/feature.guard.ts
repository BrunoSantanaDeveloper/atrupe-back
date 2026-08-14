import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanControlService } from '../plan-control.service';

export const REQUIRED_FEATURE_KEY = 'requiredFeature';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private planControlService: PlanControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Handler tem precedência sobre o controller, permitindo declarar a feature
    // uma única vez na classe e sobrescrever em endpoints específicos
    const requiredFeature = this.reflector.getAllAndOverride<string>(
      REQUIRED_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature) {
      return true; // Se não há feature requerida, permite acesso
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.companyId) {
      return false;
    }

    try {
      await this.planControlService.enforceFeature(
        user.companyId,
        requiredFeature,
      );
      return true;
    } catch (error) {
      // Propaga a mensagem do plano ("Feature não disponível no plano X") em vez
      // do 403 genérico do Nest; qualquer outra falha nega o acesso
      if (error instanceof ForbiddenException) {
        throw error;
      }
      return false;
    }
  }
}
