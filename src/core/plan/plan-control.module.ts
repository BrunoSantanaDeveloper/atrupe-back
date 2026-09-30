import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { PlanControlService } from './plan-control.service';
import { FeatureGuard } from './guards/feature.guard';
import { LimitGuard } from './guards/limit.guard';
import { TrialGuard } from './guards/trial.guard';

/**
 * Global: qualquer módulo pode usar o FeatureGuard e o PlanControlService
 * sem importar este módulo. Um import esquecido derrubava a API no boot
 * (erro de injeção), e o bloqueio por plano agora está em muitos módulos.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [PlanControlService, FeatureGuard, LimitGuard, TrialGuard],
  exports: [PlanControlService, FeatureGuard, LimitGuard, TrialGuard],
})
export class PlanControlModule {}
