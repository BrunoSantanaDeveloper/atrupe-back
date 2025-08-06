import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanControlService } from '../plan-control.service';

export const TRIAL_RESTRICTED_KEY = 'trialRestricted';

@Injectable()
export class TrialGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private planControlService: PlanControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isTrialRestricted = this.reflector.get<boolean>(
      TRIAL_RESTRICTED_KEY,
      context.getHandler(),
    );

    if (!isTrialRestricted) {
      return true; // Se não há restrição de trial, permite acesso
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.companyId) {
      return false;
    }

    try {
      const isTrialExpired = await this.planControlService.isTrialExpired(
        user.companyId,
      );
      return !isTrialExpired; // Permite acesso se trial NÃO expirou
    } catch (error) {
      return false;
    }
  }
}
