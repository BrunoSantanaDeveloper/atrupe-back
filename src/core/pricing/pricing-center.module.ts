import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AssemblyModule } from '../assembly/assembly.module';
import { AuthModule } from '../auth/auth.module';
import { CostAuditModule } from '../cost-base/cost-audit.module';
import { CostBaseModule } from '../cost-base/cost-base.module';
import { PricingCenterController } from './pricing-center.controller';
import { PricingCenterService } from './pricing-center.service';
import { PricingModule } from './pricing.module';

/**
 * As rotas da precificação. Fica fora do PricingModule, que só dá os
 * parâmetros e o markup: a composição importa o PricingModule, e a
 * precificação lê a composição (o custo do produto).
 */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    PricingModule,
    CostAuditModule,
    CostBaseModule,
    AssemblyModule,
  ],
  controllers: [PricingCenterController],
  providers: [PricingCenterService],
})
export class PricingCenterModule {}
