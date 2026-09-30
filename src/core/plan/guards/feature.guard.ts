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
    const requiredFeature = this.reflector.getAllAndOverride<string | string[]>(
      REQUIRED_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature || requiredFeature.length === 0) {
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
      // Propaga o 403 do plano (code FEATURE_NOT_AVAILABLE, com o nome do
      // recurso) em vez do 403 genérico do Nest; qualquer outra falha nega.
      if (error instanceof ForbiddenException) {
        throw error;
      }
      return false;
    }
  }
}
