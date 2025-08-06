import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
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
    const requiredFeature = this.reflector.get<string>(
      REQUIRED_FEATURE_KEY,
      context.getHandler(),
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
      return false; // Guard retorna false, a exceção será tratada pelo service
    }
  }
}
