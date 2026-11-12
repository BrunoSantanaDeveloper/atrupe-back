import { Module } from '@nestjs/common';
import { PrismaModule } from 'nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { PlanControlModule } from '../plan/plan-control.module';
import { PrintController } from './print.controller';
import { PrintService } from './print.service';

/** A impressão da gráfica rápida no LITE (12/11/2026). */
@Module({
  imports: [AuthModule, PrismaModule, PlanControlModule],
  controllers: [PrintController],
  providers: [PrintService],
  exports: [PrintService],
})
export class PrintModule {}
