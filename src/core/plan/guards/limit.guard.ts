import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanControlService } from '../plan-control.service';

export const REQUIRED_LIMIT_KEY = 'requiredLimit';

export interface LimitConfig {
  key: string;
  action: 'create' | 'check'; // create = vai criar +1, check = só verificar atual
}

@Injectable()
export class LimitGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private planControlService: PlanControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limitConfig = this.reflector.get<LimitConfig>(
      REQUIRED_LIMIT_KEY,
      context.getHandler(),
    );

    if (!limitConfig) {
      return true; // Se não há limite requerido, permite acesso
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.companyId) {
      return false;
    }

    try {
      // Obter uso atual baseado no tipo de limite (SISTEMA DINÂMICO)
      let currentUsage = await this.planControlService.getCurrentUsage(
        user.companyId,
        limitConfig.key,
      );

      // Se é uma ação de criação, simular +1 no uso atual
      if (limitConfig.action === 'create') {
        currentUsage += 1;
      }

      await this.planControlService.enforceLimit(
        user.companyId,
        limitConfig.key,
        currentUsage,
      );
      return true;
    } catch (error) {
      // O 403 do limite leva a mensagem do plano; engoli-lo virava um 403
      // genérico sem explicação.
      if (error instanceof ForbiddenException) {
        throw error;
      }
      return false;
    }
  }
}
