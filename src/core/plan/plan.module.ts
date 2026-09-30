import { Module } from '@nestjs/common';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { PlanConfigController } from './plan-config.controller';
import { PlanConfigService } from './plan-config.service';
import { PrismaModule } from 'nestjs-prisma';

@Module({
  imports: [PrismaModule],
  controllers: [PlanController, PlanConfigController],
  providers: [PlanService, PlanConfigService],
  exports: [PlanConfigService],
})
export class PlanModule {}
