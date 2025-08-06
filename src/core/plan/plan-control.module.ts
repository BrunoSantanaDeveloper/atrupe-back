import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { PlanControlService } from './plan-control.service';
import { FeatureGuard } from './guards/feature.guard';
import { LimitGuard } from './guards/limit.guard';
import { TrialGuard } from './guards/trial.guard';

@Module({
  imports: [PrismaModule],
  providers: [PlanControlService, FeatureGuard, LimitGuard, TrialGuard],
  exports: [PlanControlService, FeatureGuard, LimitGuard, TrialGuard],
})
export class PlanControlModule {}
